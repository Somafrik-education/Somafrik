"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { FUNCTIONAL_RBAC_SCHEMA_SQL } = require("../db/functionalRbacSchema");
const { createEstablishmentRolesPgStore } = require("../db/establishmentRolesPgStore");
const { createFunctionalRbacPgStore } = require("../db/functionalRbacPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { reconcileCanonicalSystemRoles } = require("./systemRolesReconciliation");
const { resolveEffectivePermissionsForPrincipal } = require("./functionalRbacService");
const { RbacService } = require("../services/rbacService");
const { SYSTEM_ROLES_RECONCILIATION_ERROR } = require("./canonicalSystemRoles");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_SYSTEM_ROLES_RBAC_IT_DATABASE ?? "somafrik_system_roles_rbac_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const PRODUCTION_TEACHER_ALIASES = [
  "Voir élèves",
  "Modifier notes",
  "Créer notes",
  "Faire appel",
  "Messages parents",
  "Voir examens",
  "Voir bulletins",
  "Voir documents",
  "Planning de cours:READ",
  "Salles:READ",
  "Remplacements:READ",
];

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function loadPgPool() {
  try {
    return require("pg").Pool;
  } catch {
    return null;
  }
}

async function ensureDatabase(Pool, databaseUrl, databaseName) {
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
    getEstablishmentRolesStore: () => createEstablishmentRolesPgStore(repo),
    getFunctionalRbacStore: () => createFunctionalRbacPgStore(repo),
    createTxScope(tx) {
      if (!tx) return repo;
      const scoped = {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        getEstablishmentRolesStore: () => createEstablishmentRolesPgStore(scoped),
        getFunctionalRbacStore: () => createFunctionalRbacPgStore(scoped),
      };
      return scoped;
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
  };
  return repo;
}

async function resetSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
  await pool.query(FUNCTIONAL_RBAC_SCHEMA_SQL);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("systemRolesReconciliation.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const Pool = loadPgPool();
  if (!Pool) {
    console.log("systemRolesReconciliation.pg.test.js SKIP (module pg absent)");
    return;
  }

  const url = await ensureDatabase(Pool, DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  const repo = createRepo(pool);
  const rbac = new RbacService();

  try {
    await resetSchema(pool);
    const store = createEstablishmentRolesPgStore(repo);
    await store.insertRole({
      roleCode: "enseignant",
      roleName: "Enseignant",
      permissions: PRODUCTION_TEACHER_ALIASES,
      delegationPermissions: PRODUCTION_TEACHER_ALIASES,
    });
    const rbacStore = createFunctionalRbacPgStore(repo);
    await rbacStore.seedFunctionalModules();
    await rbacStore.upsertGrant({
      roleKey: "TEACHER",
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: "students",
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      updatedBy: "seed-prod",
    });

    const before = await resolveEffectivePermissionsForPrincipal(repo, {
      role: "Enseignant",
      roleKeys: ["TEACHER"],
    });
    assert.equal(
      rbac.canAccess({ role: "Enseignant", permissions: before.permissions }, "GET /api/backoffice/messages"),
      false,
    );

    await reconcileCanonicalSystemRoles(repo);
    await reconcileCanonicalSystemRoles(repo);

    const after = await resolveEffectivePermissionsForPrincipal(repo, {
      role: "Enseignant",
      roleKeys: ["TEACHER"],
    });
    assert.ok(after.permissions.includes("Messages:READ"));
    assert.ok(after.permissions.includes("Élèves:READ"));
    assert.equal(rbac.canAccess({ role: "Enseignant", permissions: after.permissions }, "GET /api/students"), true);
    assert.equal(
      rbac.canAccess({ role: "Enseignant", permissions: after.permissions }, "GET /api/backoffice/messages"),
      true,
    );

    const tokenCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM establishment_role_permissions erp
       JOIN establishment_roles er ON er.id = erp.role_id
       WHERE er.role_name = 'Enseignant'`,
    );
    const firstCount = tokenCount.rows[0].count;
    await reconcileCanonicalSystemRoles(repo);
    const secondCount = (
      await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM establishment_role_permissions erp
         JOIN establishment_roles er ON er.id = erp.role_id
         WHERE er.role_name = 'Enseignant'`,
      )
    ).rows[0].count;
    assert.equal(firstCount, secondCount);

    await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, display_order, status, school_assignable)
       VALUES ('ENSEIGNANT', 'Docent Teacher', 'school', 99, 'active', TRUE)`,
    );
    await assert.rejects(
      () => reconcileCanonicalSystemRoles(repo),
      (error) => error.code === SYSTEM_ROLES_RECONCILIATION_ERROR,
    );

    const migration = fs.readFileSync(
      path.join(__dirname, "../db/migrations/20260903_p0_system_roles_rbac_reconciliation.sql"),
      "utf8",
    );
    assert.match(migration, /BEGIN;/);
    assert.match(migration, /COMMIT;/);
    assert.match(migration, /Élèves:READ/);
    assert.match(migration, /Messages:READ/);

    console.log("systemRolesReconciliation.pg.test.js PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
