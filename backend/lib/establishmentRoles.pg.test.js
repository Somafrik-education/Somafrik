"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL, assertEstablishmentRolesSchemaPreflight } = require("../db/establishmentRolesSchema");
const { createEstablishmentRolesPgStore } = require("../db/establishmentRolesPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const {
  createRole,
  updateRole,
  archiveRole,
  ensureEstablishmentRolesConstraints,
  stripLegacyUserRolesPayloads,
  buildSeedRolesFromData,
} = require("./establishmentRolesService");
const { ESTABLISHMENT_ROLES_ERROR, assertNoLegacyUserRolesWrite } = require("./establishmentRolesManagement");
const { createResidualPgStore } = require("../db/residualPgStore");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ESTABLISHMENT_ROLES_IT_DATABASE ?? "somafrik_establishment_roles_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const maintenance = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenance });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createRepo(pool) {
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    getSchoolByCode: async (code) =>
      repo.one(
        `SELECT s.id, s.school_code, s.country_id, c.iso_code AS country_code
         FROM schools s JOIN countries c ON c.id = s.country_id
         WHERE upper(s.school_code) = upper($1)`,
        [code],
      ),
    getEstablishmentRolesStore: () => createEstablishmentRolesPgStore(repo),
    listEstablishmentRoles: (options) => createEstablishmentRolesPgStore(repo).listRoles(options),
    createEstablishmentRole: (payload, principal, auditMeta) => createRole(repo, payload, principal, auditMeta),
    updateEstablishmentRole: (roleId, patch, principal, auditMeta) => updateRole(repo, roleId, patch, principal, auditMeta),
    archiveEstablishmentRole: (roleId, principal, auditMeta) => archiveRole(repo, roleId, principal, auditMeta),
    createTxScope(tx) {
      if (!tx) return repo;
      return {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        getEstablishmentRolesStore: () => createEstablishmentRolesPgStore(this),
        recordAudit: async (payload) => {
          if (payload.__failAudit) throw new Error("audit failed");
          await tx.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [null, null, payload.action, payload.entityType, payload.entityId, JSON.stringify(payload.oldValue ?? null), JSON.stringify(payload.newValue ?? null)],
          );
        },
      };
    },
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    getResidualStore: () => createResidualPgStore(repo),
    saveAcademicConfig: (schoolCode, config, tx) => createResidualPgStore(repo).saveAcademicConfig(schoolCode, config, tx),
  };
  return repo;
}

async function seedSchool(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'Test', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  return { schoolId: school.rows[0].id, schoolCode: "CD-2026-0001" };
}

async function resetBaseSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations/20260814_residual_state_canonical.sql"), "utf8"));
}

async function main() {
  if (!DATABASE_URL) {
    console.log("establishmentRoles.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  const superPrincipal = { role: "Super Administrateur Somafrik", sub: "super-1" };
  const schoolPrincipal = { role: "Admin School", sub: "admin-1", schoolCode: "CD-2026-0001" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

  try {
    await resetBaseSchema(pool);
    const { schoolId } = await seedSchool(pool);
    await pool.query(
      `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())`,
      [schoolId, JSON.stringify({ userRoles: ["Secrétaire"], periods: [] })],
    );

    const repo = createRepo(pool);
    await assertEstablishmentRolesSchemaPreflight(repo);
    await assert.rejects(
      () => ensureEstablishmentRolesConstraints(repo, console),
      (error) => error.code === ESTABLISHMENT_ROLES_ERROR.LEGACY_ESTABLISHMENT_ROLES_AMBIGUOUS,
    );

    await pool.query(
      `UPDATE school_academic_configs SET config_payload = $2::jsonb WHERE school_id = $1`,
      [schoolId, JSON.stringify({ periods: [] })],
    );
    await ensureEstablishmentRolesConstraints(repo, console);
    await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
    await stripLegacyUserRolesPayloads(repo);
    await createEstablishmentRolesPgStore(repo).seedDefaultRolesIfEmpty(buildSeedRolesFromData());

    const created = await repo.createEstablishmentRole(
      {
        roleName: "Lot2 PG Auditeur",
        roleCode: "lot2_pg_auditeur",
        permissions: ["Documents:READ"],
        delegationPermissions: ["Documents:READ"],
      },
      superPrincipal,
      auditMeta,
    );
    assert.ok(created.id);

    await assert.rejects(
      () =>
        repo.createEstablishmentRole(
          { roleName: "Interdit", roleCode: "interdit", permissions: ["ALL_PRIVILEGES"] },
          superPrincipal,
          auditMeta,
        ),
      (error) => error.statusCode === 403,
    );

    await assert.rejects(
      () =>
        repo.createEstablishmentRole(
          { roleName: "School", roleCode: "school_role", permissions: ["Classes:READ"] },
          schoolPrincipal,
          auditMeta,
        ),
      (error) => error.statusCode === 403,
    );

    const updated = await repo.updateEstablishmentRole(
      created.id,
      { permissions: ["Documents:READ", "Classes:READ"] },
      superPrincipal,
      auditMeta,
    );
    assert.ok(updated.permissions.includes("Classes:READ"));

    const emptyRole = await repo.createEstablishmentRole(
      { roleName: "Lot2 PG Vide", roleCode: "lot2_pg_vide", permissions: [], delegationPermissions: [] },
      superPrincipal,
      auditMeta,
    );
    const permissionsMap = await repo.getEstablishmentRolesStore().getPermissionsMap();
    assert.ok(Object.prototype.hasOwnProperty.call(permissionsMap, "Lot2 PG Vide"));
    assert.deepEqual(permissionsMap["Lot2 PG Vide"], []);

    const assignable = await repo.listEstablishmentRoles({ schoolAssignableOnly: true });
    assert.ok(assignable.some((row) => row.roleName === "Secrétaire"));

    const archived = await repo.archiveEstablishmentRole(created.id, superPrincipal, auditMeta);
    assert.equal(archived.status, "archived");

    const config = await repo.getResidualStore().getAcademicConfig("CD-2026-0001");
    assert.ok(Array.isArray(config.userRoles));
    assert.ok(config.userRoles.includes("Secrétaire"));
    assert.equal("userRoles" in (await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolId])).rows[0].config_payload, false);

    assert.throws(() => assertNoLegacyUserRolesWrite({ userRoles: ["Secrétaire"] }));

    console.log("establishmentRoles.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
