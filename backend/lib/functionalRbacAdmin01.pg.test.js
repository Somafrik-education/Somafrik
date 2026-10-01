"use strict";

/**
 * ADMIN-01 — preuve PostgreSQL réelle (CI postgres:16 éphémère).
 *
 * Fail-closed : refuse toute URL qui n'est pas un hôte loopback + base
 * maintenance autorisée (postgres|somafrik) ou la base IT dédiée.
 * DROP SCHEMA public uniquement après preuve que current_database()
 * = somafrik_functional_rbac_admin01_it.
 *
 * Ne pas pointer vers production / préprod / démo.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { FUNCTIONAL_RBAC_SCHEMA_SQL } = require("../db/functionalRbacSchema");
const { createFunctionalRbacPgStore } = require("../db/functionalRbacPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const {
  getConfiguredPermissions,
  getEffectivePermissionsConfigured,
  patchConfiguredPermissions,
  resetConfiguredPermissionOverrides,
} = require("./functionalRbacService");
const { FUNCTIONAL_RBAC_ERROR } = require("./functionalRbacManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_FUNCTIONAL_RBAC_ADMIN01_IT_DATABASE ?? "somafrik_functional_rbac_admin01_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const CONNECTION_HOST_KEYS = ["host", "hostname", "hostaddr"];
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

const SUPER_ADMIN = { role: "Super Administrateur Somafrik", identifier: "superadmin", roleKeys: ["SUPER_ADMIN"] };
const SCHOOL_ADMIN = { role: "Admin School", identifier: "school-admin", roleKeys: ["SCHOOL_ADMIN"] };
const ROLE = "PREFET_ETUDES";
const MODULE = "students";
const SCHOOL_A = "CD-2026-0001";
const SCHOOL_B = "CD-2026-0002";

const INHERITED = { canCreate: false, canRead: true, canUpdate: false, canDelete: false };
const GLOBAL_FLAGS = { canCreate: false, canRead: true, canUpdate: true, canDelete: true };
const OVERRIDE_FLAGS = { canCreate: false, canRead: true, canUpdate: true, canDelete: false };

function databaseNameFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return decodeURIComponent(String(parsed.pathname ?? "").replace(/^\//, "")).trim();
}

function normalizeHost(host) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackUrlHost(host) {
  const value = normalizeHost(host);
  if (!value) return false;
  if (URL_LOOPBACK_HOSTS.has(value)) return true;
  if (value.startsWith("::ffff:") && URL_LOOPBACK_HOSTS.has(value.slice("::ffff:".length))) return true;
  return false;
}

function hostFromUrl(databaseUrl) {
  return normalizeHost(new URL(databaseUrl).hostname);
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function isolationRefusal({ itDb, sourceDb, host, databaseUrl, env } = {}) {
  if (!itDb) return "IT database name empty after sanitization";
  if (FORBIDDEN_DATABASES.has(itDb)) return `IT database name forbidden (${itDb})`;
  if (itDb !== "somafrik_functional_rbac_admin01_it" && !/^[a-z][a-z0-9_]*_admin01_it$/.test(itDb)) {
    return `IT database must be somafrik_functional_rbac_admin01_it (got ${itDb})`;
  }
  if (!sourceDb) return "DATABASE_URL database empty";
  if (FORBIDDEN_DATABASES.has(sourceDb)) return `DATABASE_URL database forbidden (${sourceDb})`;
  if (!SOURCE_ALLOWLIST.has(sourceDb)) {
    return `DATABASE_URL database ${sourceDb} is not an authorized CI/IT maintenance database`;
  }
  if (databaseUrl && REMOTE_URL_MARKERS.test(databaseUrl)) {
    return "DATABASE_URL matches a remote/demo/preprod/production marker — refusing";
  }
  if (databaseUrl) {
    const parsed = new URL(databaseUrl);
    for (const key of CONNECTION_HOST_KEYS) {
      if (parsed.searchParams.has(key)) {
        return `DATABASE_URL contains ${key} connection-destination override — refusing`;
      }
    }
  }
  for (const key of ["PGHOST", "PGHOSTADDR"]) {
    const value = String((env || process.env)[key] ?? "").trim();
    if (!value) continue;
    if (value.startsWith("/")) continue;
    if (!isLoopbackUrlHost(value)) {
      return `${key} overrides connection destination (${value}) — refusing`;
    }
  }
  if (!isLoopbackUrlHost(host)) {
    return `DATABASE_URL host is not a loopback test host (${host || "empty"})`;
  }
  return null;
}

function createRepo(pool) {
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    getFunctionalRbacStore: () => createFunctionalRbacPgStore(repo),
    createTxScope(tx) {
      if (!tx) return repo;
      const scoped = {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        recordAudit: async (payload) => {
          await tx.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              null,
              null,
              payload.action,
              payload.entityType,
              payload.entityId,
              JSON.stringify(payload.oldValue ?? null),
              JSON.stringify(payload.newValue ?? null),
            ],
          );
        },
      };
      scoped.getFunctionalRbacStore = () => createFunctionalRbacPgStore(scoped);
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
    recordAudit: async () => {},
  };
  return repo;
}

async function schoolModuleRows(pool, schoolId, moduleKey = MODULE) {
  const { rows } = await pool.query(
    `SELECT id::text AS id,
            role_key,
            module_key,
            scope_type,
            school_id::text AS school_id,
            country_id::text AS country_id,
            status,
            can_create,
            can_read,
            can_update,
            can_delete,
            version,
            updated_at
       FROM role_module_permissions
      WHERE upper(role_key) = $1
        AND module_key = $2
        AND scope_type = 'school'
        AND school_id = $3::uuid
      ORDER BY status, created_at, id`,
    [ROLE, moduleKey, schoolId],
  );
  return rows;
}

function activeRows(rows) {
  return rows.filter((row) => row.status === "active");
}

function archivedRows(rows) {
  return rows.filter((row) => row.status === "archived");
}

function fingerprint(rows) {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      version: Number(row.version),
      can_create: Boolean(row.can_create),
      can_read: Boolean(row.can_read),
      can_update: Boolean(row.can_update),
      can_delete: Boolean(row.can_delete),
      updated_at: String(row.updated_at),
    })),
  );
}

function logSql(label, rows) {
  const compact = rows.map((row) => ({
    role: row.role_key,
    module: row.module_key,
    scope: row.scope_type,
    school_id: row.school_id,
    status: row.status,
    can_create: Boolean(row.can_create),
    can_read: Boolean(row.can_read),
    can_update: Boolean(row.can_update),
    can_delete: Boolean(row.can_delete),
    version: Number(row.version),
  }));
  console.log(`${label} ${JSON.stringify(compact)}`);
}

async function scenario(id, fn) {
  try {
    await fn();
    console.log(`${id} PASS`);
  } catch (error) {
    console.log(`${id} FAIL`);
    throw error;
  }
}

async function ensureItDatabase(sourceUrl, itDb) {
  const sourceDb = databaseNameFromUrl(sourceUrl);
  if (sourceDb === itDb) return sourceUrl;
  const pool = new PoolRef.Pool({ connectionString: sourceUrl });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [itDb]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${itDb}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(sourceUrl, itDb);
}

const PoolRef = { Pool: null };

async function assertAuthorizedItConnection(pool, itDb) {
  const { rows } = await pool.query(`SELECT current_database() AS name, inet_server_addr()::text AS addr`);
  const current = String(rows[0]?.name ?? "").trim();
  if (current !== itDb) {
    throw new Error(
      `Refusing DROP SCHEMA public: current_database=${current || "empty"} is not authorized IT ${itDb}`,
    );
  }
}

async function dropItDatabase(sourceUrl, itDb) {
  if (databaseNameFromUrl(sourceUrl) === itDb) return;
  const pool = new PoolRef.Pool({ connectionString: sourceUrl });
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [itDb],
    );
    await pool.query(`DROP DATABASE IF EXISTS ${itDb}`);
  } catch (error) {
    console.log(`cleanup SKIP (${error.message})`);
  } finally {
    await pool.end();
  }
}

async function seedInheritance(store, countryId) {
  await store.seedFunctionalModules();
  await store.upsertGrant({
    roleKey: ROLE,
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: MODULE,
    ...GLOBAL_FLAGS,
    updatedBy: "bootstrap",
  });
  await store.upsertGrant({
    roleKey: ROLE,
    scopeType: "country",
    countryId,
    schoolId: null,
    moduleKey: MODULE,
    ...INHERITED,
    updatedBy: "bootstrap",
  });
}

async function main() {
  if (!DATABASE_URL) {
    console.log("functionalRbacAdmin01.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  let sourceDb;
  let host;
  try {
    sourceDb = databaseNameFromUrl(DATABASE_URL);
    host = hostFromUrl(DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL unparseable — refusing ADMIN-01 PG runner");
  }

  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb,
    host,
    databaseUrl: DATABASE_URL,
    env: process.env,
  });
  if (refusal) {
    throw new Error(`Refusing ADMIN-01 PG runner: ${refusal}`);
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    throw new Error("module pg absent — refusing ADMIN-01 PG runner");
  }
  PoolRef.Pool = Pool;

  const isolatedUrl = await ensureItDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  let passed = 0;
  try {
    await assertAuthorizedItConnection(pool, IT_DB);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
    await pool.query(FUNCTIONAL_RBAC_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryId = country.rows[0].id;
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, $2, 'INSTITUT NURU', 'active') RETURNING id`,
      [countryId, SCHOOL_A],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, $2, 'Autre ecole', 'active') RETURNING id`,
      [countryId, SCHOOL_B],
    );
    const schoolAId = schoolA.rows[0].id;
    const schoolBId = schoolB.rows[0].id;

    const repo = createRepo(pool);
    const store = createFunctionalRbacPgStore(repo);
    await seedInheritance(store, countryId);

    await scenario("PG-01", async () => {
      const rows = await schoolModuleRows(pool, schoolAId);
      assert.equal(activeRows(rows).length, 0, "PG-01 aucune ligne school active");
      const effective = await getEffectivePermissionsConfigured(
        repo,
        { roleKey: ROLE, countryCode: "CD", schoolCode: SCHOOL_A },
        SUPER_ADMIN,
      );
      const students = effective.modules.find((row) => row.moduleKey === MODULE);
      assert.equal(students.source, "country");
      assert.equal(students.inherited, true);
      assert.equal(students.configured, false);
      assert.equal(students.canCreate, false);
      assert.equal(students.canRead, true);
      assert.equal(students.canUpdate, false);
      assert.equal(students.canDelete, false);
      logSql("PG-01 SQL", rows);
      passed += 1;
    });

    await scenario("PG-02", async () => {
      const before = await schoolModuleRows(pool, schoolAId);
      const saved = await patchConfiguredPermissions(
        repo,
        {
          roleKey: ROLE,
          countryCode: "CD",
          schoolCode: SCHOOL_A,
          grants: [{ moduleKey: MODULE, ...INHERITED }],
        },
        SUPER_ADMIN,
        {},
      );
      assert.equal(saved.grants[0].skipped, true);
      const after = await schoolModuleRows(pool, schoolAId);
      assert.equal(activeRows(after).length, 0, "PG-02 aucune ligne school status=active");
      assert.equal(fingerprint(before), fingerprint(after), "PG-02 SQL inchangé");
      logSql("PG-02 SQL", after);
      passed += 1;
    });

    let createdUpdatedAt;
    await scenario("PG-03", async () => {
      const saved = await patchConfiguredPermissions(
        repo,
        {
          roleKey: ROLE,
          countryCode: "CD",
          schoolCode: SCHOOL_A,
          grants: [{ moduleKey: MODULE, ...OVERRIDE_FLAGS }],
        },
        SUPER_ADMIN,
        {},
      );
      createdUpdatedAt = saved.updatedAt;
      const after = await schoolModuleRows(pool, schoolAId);
      const active = activeRows(after);
      assert.equal(active.length, 1, "PG-03 exactement 1 ligne school active");
      assert.equal(active[0].can_create, false);
      assert.equal(active[0].can_read, true);
      assert.equal(active[0].can_update, true);
      assert.equal(active[0].can_delete, false);
      const configured = await getConfiguredPermissions(
        repo,
        { roleKey: ROLE, countryCode: "CD", schoolCode: SCHOOL_A },
        SUPER_ADMIN,
      );
      const students = configured.modules.find((row) => row.moduleKey === MODULE);
      assert.equal(students.source, "school");
      assert.equal(students.configured, true);
      assert.equal(students.canUpdate, true);
      assert.equal(students.canDelete, false);
      logSql("PG-03 SQL", after);
      passed += 1;
    });

    let archivedId;
    await scenario("PG-04", async () => {
      const before = await schoolModuleRows(pool, schoolAId);
      const activeBefore = activeRows(before);
      assert.equal(activeBefore.length, 1);
      archivedId = activeBefore[0].id;
      const reset = await resetConfiguredPermissionOverrides(
        repo,
        {
          roleKey: ROLE,
          countryCode: "CD",
          schoolCode: SCHOOL_A,
          moduleKey: MODULE,
          expectedUpdatedAt: createdUpdatedAt,
        },
        SUPER_ADMIN,
        {},
      );
      const after = await schoolModuleRows(pool, schoolAId);
      const archived = archivedRows(after).find((row) => row.id === archivedId);
      assert.ok(archived, "PG-04 ancienne ligne status=archived");
      assert.equal(archived.status, "archived");
      assert.equal(activeRows(after).length, 0, "PG-04 0 ligne school active");
      const students = reset.modules.find((row) => row.moduleKey === MODULE);
      assert.equal(students.source, "country");
      assert.equal(students.configured, false);
      assert.equal(students.canUpdate, false);
      assert.equal(students.canDelete, false);
      logSql("PG-04 SQL", after);
      passed += 1;
    });

    await scenario("PG-05", async () => {
      const saved = await patchConfiguredPermissions(
        repo,
        {
          roleKey: ROLE,
          countryCode: "CD",
          schoolCode: SCHOOL_A,
          grants: [{ moduleKey: MODULE, ...OVERRIDE_FLAGS }],
        },
        SUPER_ADMIN,
        {},
      );
      createdUpdatedAt = saved.updatedAt;
      const after = await schoolModuleRows(pool, schoolAId);
      assert.equal(activeRows(after).length, 1, "PG-05 exactement 1 active");
      assert.ok(
        archivedRows(after).some((row) => row.id === archivedId && row.status === "archived"),
        "PG-05 ancienne archived conservée",
      );
      assert.notEqual(activeRows(after)[0].id, archivedId);
      logSql("PG-05 SQL", after);
      passed += 1;
    });

    await scenario("PG-06", async () => {
      const before = await schoolModuleRows(pool, schoolAId);
      await assert.rejects(
        () =>
          resetConfiguredPermissionOverrides(
            repo,
            {
              roleKey: ROLE,
              countryCode: "CD",
              schoolCode: SCHOOL_A,
              moduleKey: MODULE,
              expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
            },
            SUPER_ADMIN,
            {},
          ),
        (error) => error.statusCode === 409 && error.code === FUNCTIONAL_RBAC_ERROR.CONFLICT,
      );
      const after = await schoolModuleRows(pool, schoolAId);
      assert.equal(fingerprint(before), fingerprint(after), "PG-06 SQL inchangé, aucune archive");
      assert.equal(activeRows(after).length, 1);
      logSql("PG-06 SQL", after);
      passed += 1;
    });

    await scenario("PG-07", async () => {
      const before = await schoolModuleRows(pool, schoolAId);
      await assert.rejects(
        () =>
          resetConfiguredPermissionOverrides(
            repo,
            {
              roleKey: ROLE,
              countryCode: "CD",
              schoolCode: SCHOOL_A,
              moduleKey: MODULE,
              expectedUpdatedAt: createdUpdatedAt,
            },
            SCHOOL_ADMIN,
            {},
          ),
        (error) => error.statusCode === 403,
      );
      const after = await schoolModuleRows(pool, schoolAId);
      assert.equal(fingerprint(before), fingerprint(after), "PG-07 DB strictement inchangée");
      logSql("PG-07 SQL", after);
      passed += 1;
    });

    await scenario("PG-08", async () => {
      const createdB = await patchConfiguredPermissions(
        repo,
        {
          roleKey: ROLE,
          countryCode: "CD",
          schoolCode: SCHOOL_B,
          grants: [{ moduleKey: MODULE, canCreate: true, canRead: true, canUpdate: true, canDelete: false }],
        },
        SUPER_ADMIN,
        {},
      );
      const beforeB = await schoolModuleRows(pool, schoolBId);
      assert.equal(activeRows(beforeB).length, 1);
      const resetA = await resetConfiguredPermissionOverrides(
        repo,
        {
          roleKey: ROLE,
          countryCode: "CD",
          schoolCode: SCHOOL_A,
          moduleKey: MODULE,
          expectedUpdatedAt: createdUpdatedAt,
        },
        SUPER_ADMIN,
        {},
      );
      const afterA = await schoolModuleRows(pool, schoolAId);
      const afterB = await schoolModuleRows(pool, schoolBId);
      assert.equal(activeRows(afterA).length, 0, "PG-08 A archived/inactive");
      assert.ok(archivedRows(afterA).length >= 1);
      assert.equal(fingerprint(beforeB), fingerprint(afterB), "PG-08 B inchangée");
      assert.equal(activeRows(afterB).length, 1);
      assert.equal(activeRows(afterB)[0].can_create, true);
      const effectiveB = await getEffectivePermissionsConfigured(
        repo,
        { roleKey: ROLE, countryCode: "CD", schoolCode: SCHOOL_B },
        SUPER_ADMIN,
      );
      const studentsB = effectiveB.modules.find((row) => row.moduleKey === MODULE);
      assert.equal(studentsB.source, "school");
      assert.equal(studentsB.canCreate, true);
      const studentsA = resetA.modules.find((row) => row.moduleKey === MODULE);
      assert.equal(studentsA.source, "country");
      logSql("PG-08 SQL A", afterA);
      logSql("PG-08 SQL B", afterB);
      void createdB;
      passed += 1;
    });

    assert.equal(passed, 8, "8/8 scénarios ADMIN-01 PG");
    console.log("functionalRbacAdmin01.pg.test.js 8/8 PASS");
  } finally {
    await pool.end();
    await dropItDatabase(DATABASE_URL, IT_DB);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
