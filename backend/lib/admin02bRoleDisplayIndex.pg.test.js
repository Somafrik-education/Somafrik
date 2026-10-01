"use strict";

/**
 * ADMIN-02B hotfix — loadRoleDisplayIndex ne doit pas abortir une transaction
 * quand establishment_roles / display_label est absent.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { mapUserRow } = require("./clientsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN02B_DISPLAY_INDEX_IT_DATABASE ?? "somafrik_admin02b_display_index_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

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

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function isolationRefusal({ itDb, sourceDb, host, databaseUrl } = {}) {
  if (!itDb) return "IT database name empty after sanitization";
  if (FORBIDDEN_DATABASES.has(itDb)) return `IT database name forbidden (${itDb})`;
  if (itDb !== "somafrik_admin02b_display_index_it" && !/^[a-z][a-z0-9_]*_display_index_it$/.test(itDb)) {
    return `IT database must be somafrik_admin02b_display_index_it (got ${itDb})`;
  }
  if (!sourceDb) return "DATABASE_URL database empty";
  if (FORBIDDEN_DATABASES.has(sourceDb)) return `DATABASE_URL database forbidden (${sourceDb})`;
  if (!SOURCE_ALLOWLIST.has(sourceDb)) {
    return `DATABASE_URL database ${sourceDb} is not an authorized CI/IT maintenance database`;
  }
  if (databaseUrl && REMOTE_URL_MARKERS.test(databaseUrl)) {
    return "DATABASE_URL matches a remote/demo/preprod/production marker — refusing";
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
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const scoped = {
          query: (sql, params) => tx.query(sql, params),
          one: (sql, params) => tx.one(sql, params),
          all: (sql, params) => tx.all(sql, params),
        };
        const result = await fn(scoped);
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

const PoolRef = { Pool: null };

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
    console.log("admin02bRoleDisplayIndex.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  let sourceDb;
  let host;
  try {
    sourceDb = databaseNameFromUrl(DATABASE_URL);
    host = hostFromUrl(DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL unparseable — refusing ADMIN-02B display-index PG runner");
  }

  const refusal = isolationRefusal({ itDb: IT_DB, sourceDb, host, databaseUrl: DATABASE_URL });
  if (refusal) throw new Error(`Refusing ADMIN-02B display-index PG runner: ${refusal}`);

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    throw new Error("module pg absent — refusing ADMIN-02B display-index PG runner");
  }
  PoolRef.Pool = Pool;

  const isolatedUrl = await ensureItDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await assertAuthorizedItConnection(pool, IT_DB);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));

    const missing = await pool.query(`SELECT to_regclass('public.establishment_roles') AS ref`);
    assert.equal(missing.rows[0].ref, null, "ce scénario exige l'absence de establishment_roles");

    const user = await pool.query(
      `INSERT INTO users (user_code, first_name, last_name, role, status)
       VALUES ('U-DL-PROBE', 'Ada', 'School', 'Admin School', 'active')
       RETURNING id`,
    );
    const userId = user.rows[0].id;
    const repo = createRepo(pool);

    const absent = await repo.withTransaction(async (tx) => {
      const store = createClientsPgStore(tx);
      const row = await store.getUserById(userId);
      assert.ok(row, "getUserById doit réussir sans establishment_roles");
      assert.equal(row.display_label, null);
      const followUp = await tx.one(`SELECT 1 AS ok`);
      assert.equal(Number(followUp.ok), 1, "requête SQL suivante encore valide");
      const mapped = mapUserRow(row);
      assert.equal(mapped.role, "Admin School");
      assert.equal(mapped.effectiveRoleLabel, "Admin School");
      return { aborted: false, followUpOk: followUp.ok };
    });
    assert.equal(absent.aborted, false);
    assert.equal(Number(absent.followUpOk), 1);
    console.log("PG-DL-INDEX-01 transaction sans establishment_roles non aborted PASS");

    await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
    await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, school_assignable, display_label)
       VALUES ('SCHOOL_ADMIN', 'Admin School', 'school', FALSE, 'Directeur')`,
    );

    const present = await repo.withTransaction(async (tx) => {
      const store = createClientsPgStore(tx);
      const row = await store.getUserById(userId);
      assert.equal(row.display_label, "Directeur");
      const mapped = mapUserRow(row);
      assert.equal(mapped.effectiveRoleLabel, "Directeur");
      assert.equal(mapped.role, "Admin School");
      const followUp = await tx.one(`SELECT 1 AS ok`);
      assert.equal(Number(followUp.ok), 1);
      return mapped.effectiveRoleLabel;
    });
    assert.equal(present, "Directeur");
    console.log("PG-DL-INDEX-02 establishment_roles + display_label chargé PASS");
  } finally {
    await pool.end();
    await dropItDatabase(DATABASE_URL, IT_DB);
  }
}

function hostFromUrl(databaseUrl) {
  return normalizeHost(new URL(databaseUrl).hostname);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
