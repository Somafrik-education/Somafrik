"use strict";

/**
 * ADMIN-02B — preuves PostgreSQL PG-DL-01 → 08.
 *
 * Fail-closed : refuse toute URL qui n'est pas un hôte loopback + base
 * maintenance autorisée (postgres|somafrik) ou la base IT dédiée.
 * DROP SCHEMA public uniquement après preuve que current_database()
 * = somafrik_functional_rbac_admin02b_it.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { createEstablishmentRolesPgStore } = require("../db/establishmentRolesPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { updateRoleDisplayLabel, resetRoleDisplayLabel } = require("./establishmentRolesService");
const { applyRoleDisplayContract } = require("./roleDisplayLabels");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_FUNCTIONAL_RBAC_ADMIN02B_IT_DATABASE ?? "somafrik_functional_rbac_admin02b_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const CONNECTION_HOST_KEYS = ["host", "hostname", "hostaddr"];
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

const SUPER_ADMIN = { role: "Super Administrateur Somafrik", identifier: "superadmin", roleKeys: ["SUPER_ADMIN"] };
const COUNTRY_ADMIN = { role: "Admin Pays", identifier: "country-admin", roleKeys: ["COUNTRY_ADMIN"] };

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
  if (itDb !== "somafrik_functional_rbac_admin02b_it" && !/^[a-z][a-z0-9_]*_admin02b_it$/.test(itDb)) {
    return `IT database must be somafrik_functional_rbac_admin02b_it (got ${itDb})`;
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
    getEstablishmentRolesStore: () => createEstablishmentRolesPgStore(repo),
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
      scoped.getEstablishmentRolesStore = () => createEstablishmentRolesPgStore(scoped);
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
  const { rows } = await pool.query(`SELECT current_database() AS name`);
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

async function main() {
  if (!DATABASE_URL) {
    console.log("functionalRbacAdmin02b.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  let sourceDb;
  let host;
  try {
    sourceDb = databaseNameFromUrl(DATABASE_URL);
    host = hostFromUrl(DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL unparseable — refusing ADMIN-02B PG runner");
  }

  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb,
    host,
    databaseUrl: DATABASE_URL,
    env: process.env,
  });
  if (refusal) {
    throw new Error(`Refusing ADMIN-02B PG runner: ${refusal}`);
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    throw new Error("module pg absent — refusing ADMIN-02B PG runner");
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

    const schoolAdmin = await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, school_assignable)
       VALUES ('SCHOOL_ADMIN', 'Admin School', 'school', FALSE)
       RETURNING *`,
    );
    const principal = await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, school_assignable)
       VALUES ('PRINCIPAL', 'Directeur', 'school', TRUE)
       RETURNING *`,
    );
    const schoolAdminId = schoolAdmin.rows[0].id;
    const user = await pool.query(
      `INSERT INTO users (user_code, first_name, last_name, role, status)
       VALUES ('U-SA-01', 'Ada', 'School', 'Admin School', 'active')
       RETURNING id, role`,
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_key, status)
       VALUES ($1, 'SCHOOL_ADMIN', 'active')`,
      [user.rows[0].id],
    );

    const repo = createRepo(pool);

    await scenario("PG-DL-01", async () => {
      const col = await pool.query(
        `SELECT is_nullable, data_type
         FROM information_schema.columns
         WHERE table_name = 'establishment_roles' AND column_name = 'display_label'`,
      );
      assert.equal(col.rows.length, 1);
      assert.equal(col.rows[0].data_type, "text");
      assert.equal(col.rows[0].is_nullable, "YES");
      const unique = await pool.query(
        `SELECT 1
         FROM pg_constraint
         WHERE conrelid = 'establishment_roles'::regclass
           AND contype = 'u'
           AND pg_get_constraintdef(oid) ILIKE '%display_label%'`,
      );
      assert.equal(unique.rowCount, 0);
      assert.equal(schoolAdmin.rows[0].display_label, null);
      passed += 1;
    });

    await scenario("PG-DL-02", async () => {
      const saved = await updateRoleDisplayLabel(repo, schoolAdminId, { displayLabel: "Directeur" }, SUPER_ADMIN, {});
      assert.equal(saved.roleKey, "SCHOOL_ADMIN");
      assert.equal(saved.displayLabel, "Directeur");
      const raw = await pool.query(`SELECT display_label, role_code, role_name FROM establishment_roles WHERE id = $1`, [
        schoolAdminId,
      ]);
      assert.equal(raw.rows[0].display_label, "Directeur");
      assert.equal(raw.rows[0].role_code, "SCHOOL_ADMIN");
      assert.equal(raw.rows[0].role_name, "Admin School");
      passed += 1;
    });

    await scenario("PG-DL-03", async () => {
      const store = createEstablishmentRolesPgStore(repo);
      const reread = await store.getRoleById(schoolAdminId);
      assert.equal(reread.effectiveLabel, "Directeur");
      assert.equal(reread.defaultLabel, "Admin School");
      passed += 1;
    });

    await scenario("PG-DL-04", async () => {
      const reset = await resetRoleDisplayLabel(repo, schoolAdminId, SUPER_ADMIN, {});
      assert.equal(reset.displayLabel, null);
      assert.equal(reset.effectiveLabel, "Admin School");
      const raw = await pool.query(`SELECT display_label FROM establishment_roles WHERE id = $1`, [schoolAdminId]);
      assert.equal(raw.rows[0].display_label, null);
      passed += 1;
    });

    await scenario("PG-DL-05", async () => {
      await updateRoleDisplayLabel(repo, schoolAdminId, { displayLabel: "Directeur" }, SUPER_ADMIN, {});
      const rows = await pool.query(`SELECT role_code, role_name, display_label FROM establishment_roles ORDER BY role_code`);
      const school = applyRoleDisplayContract(rows.rows.find((row) => row.role_code === "SCHOOL_ADMIN"));
      const principalContract = applyRoleDisplayContract(rows.rows.find((row) => row.role_code === "PRINCIPAL"));
      assert.equal(school.effectiveLabel, "Directeur");
      assert.equal(principalContract.effectiveLabel, "Directeur");
      assert.equal(school.roleKey, "SCHOOL_ADMIN");
      assert.equal(principalContract.roleKey, "PRINCIPAL");
      assert.equal(principal.rows[0].role_name, "Directeur");
      passed += 1;
    });

    await scenario("PG-DL-06", async () => {
      const before = await pool.query(`SELECT display_label FROM establishment_roles WHERE id = $1`, [schoolAdminId]);
      await assert.rejects(
        () => updateRoleDisplayLabel(repo, schoolAdminId, { displayLabel: "Hack" }, COUNTRY_ADMIN, {}),
        (error) => error.statusCode === 403,
      );
      const after = await pool.query(`SELECT display_label FROM establishment_roles WHERE id = $1`, [schoolAdminId]);
      assert.equal(after.rows[0].display_label, before.rows[0].display_label);
      passed += 1;
    });

    await scenario("PG-DL-07", async () => {
      const audits = await pool.query(
        `SELECT action, old_value, new_value FROM audit_logs
         WHERE action IN ('ROLE_DISPLAY_LABEL_UPDATE', 'ROLE_DISPLAY_LABEL_RESET')
         ORDER BY created_at`,
      );
      assert.ok(audits.rows.some((row) => row.action === "ROLE_DISPLAY_LABEL_UPDATE"));
      assert.ok(audits.rows.some((row) => row.action === "ROLE_DISPLAY_LABEL_RESET"));
      for (const row of audits.rows) {
        const payload = row.new_value;
        assert.equal(payload.roleKey, "SCHOOL_ADMIN");
        assert.equal(Object.prototype.hasOwnProperty.call(payload, "oldDisplayLabel"), true);
        assert.equal(Object.prototype.hasOwnProperty.call(payload, "newDisplayLabel"), true);
        assert.equal(payload.jwt, undefined);
        assert.equal(payload.token, undefined);
      }
      passed += 1;
    });

    await scenario("PG-DL-08", async () => {
      const roles = await pool.query(`SELECT role_code, role_name FROM establishment_roles WHERE id = $1`, [schoolAdminId]);
      assert.equal(roles.rows[0].role_code, "SCHOOL_ADMIN");
      assert.equal(roles.rows[0].role_name, "Admin School");
      const grants = await pool.query(`SELECT role_key, status FROM user_roles WHERE user_id = $1`, [user.rows[0].id]);
      assert.equal(grants.rows.length, 1);
      assert.equal(grants.rows[0].role_key, "SCHOOL_ADMIN");
      assert.equal(grants.rows[0].status, "active");
      const account = await pool.query(`SELECT role FROM users WHERE id = $1`, [user.rows[0].id]);
      assert.equal(account.rows[0].role, "Admin School");
      passed += 1;
    });

    console.log(`ADMIN-02B PG-DL ${passed}/8 PASS`);
  } finally {
    await pool.end();
    await dropItDatabase(DATABASE_URL, IT_DB);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
