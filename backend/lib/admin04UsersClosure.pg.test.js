"use strict";

/**
 * ADMIN-04 — preuves PostgreSQL des mutations critiques Utilisateurs.
 * Base IT isolée uniquement. Aucune migration.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { hashSecret } = require("../services/credentialService");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN04_USERS_IT_DATABASE ?? "somafrik_admin04_users_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

const SUPER_ADMIN = {
  role: "Super Administrateur Somafrik",
  schoolCode: "*",
  identifier: "superadmin",
  roleKeys: ["SUPER_ADMIN"],
};
const COUNTRY_ADMIN = {
  role: "Admin Pays",
  countryCode: "CD",
  schoolCode: "*",
  identifier: "admin-rdc",
  roleKeys: ["COUNTRY_ADMIN"],
};
const AUDIT = { ipAddress: "127.0.0.1", userAgent: "admin04-pg" };

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
  if (itDb !== "somafrik_admin04_users_it" && !/^[a-z][a-z0-9_]*_admin04_users_it$/.test(itDb)) {
    return `IT database must be somafrik_admin04_users_it (got ${itDb})`;
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
  return {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
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
}

async function expectRejection(promise, { status, code }) {
  try {
    await promise;
    throw new Error(`Expected rejection ${code || status}`);
  } catch (error) {
    assert.equal(error.statusCode, status, error.message);
    if (code) assert.equal(error.code, code, error.message);
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.log("admin04UsersClosure.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb: databaseNameFromUrl(DATABASE_URL),
    host: normalizeHost(new URL(DATABASE_URL).hostname),
    databaseUrl: DATABASE_URL,
  });
  if (refusal) {
    throw new Error(`ADMIN-04 PG isolation refused: ${refusal}`);
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, IT_DB);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    await pool.query(USER_ROLES_SCHEMA_SQL);

    const cd = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const bi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, login_code)
       VALUES ($1, 'CD-2026-0001', 'Institut Bukavu', 'active', 'CD-IB-26-002'),
              ($1, 'CD-2026-0002', 'Unikin', 'active', 'CD-UN-26-001'),
              ($2, 'BI-2026-0001', 'Ecole Kanyosha', 'active', 'BI-EK-26-001')`,
      [cd.rows[0].id, bi.rows[0].id],
    );

    const repo = createRepo(pool);
    const store = createClientsPgStore(repo);

    const country = await store.provisionUser(
      {
        firstName: "Amina",
        lastName: "Pays",
        email: "u04.pg.country@test.local",
        temporaryPassword: "CountryAdmin!2026",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "CD",
      },
      SUPER_ADMIN,
      AUDIT,
    );
    const countryPg = await pool.query(
      `SELECT u.role, u.school_id, u.status, ur.role_key
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
        WHERE u.id = $1`,
      [country.id],
    );
    assert.equal(countryPg.rows[0].role, "COUNTRY_ADMIN");
    assert.equal(countryPg.rows[0].school_id, null);
    assert.equal(countryPg.rows[0].role_key, "COUNTRY_ADMIN");
    console.log("PG-U04-03 COUNTRY_ADMIN persisté PASS");

    const school = await store.provisionUser(
      {
        firstName: "Serge",
        lastName: "Ecole",
        email: "u04.pg.school@test.local",
        temporaryPassword: "SchoolAdmin!2026",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
      },
      SUPER_ADMIN,
      AUDIT,
    );
    const schoolPg = await pool.query(
      `SELECT u.role, s.school_code, ur.role_key
         FROM users u
         JOIN schools s ON s.id = u.school_id
         JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
        WHERE u.id = $1`,
      [school.id],
    );
    assert.equal(schoolPg.rows[0].role, "SCHOOL_ADMIN");
    assert.equal(schoolPg.rows[0].school_code, "CD-2026-0001");
    assert.equal(schoolPg.rows[0].role_key, "SCHOOL_ADMIN");
    console.log("PG-U04-04 SCHOOL_ADMIN persisté PASS");

    await expectRejection(
      store.provisionUser(
        {
          firstName: "Evil",
          lastName: "Twin",
          email: "u04.pg.super@test.local",
          roleKey: "SUPER_ADMIN",
          countryCode: "CD",
        },
        SUPER_ADMIN,
        AUDIT,
      ),
      { status: 400, code: CLIENTS_ERROR.ROLE_NOT_ALLOWED },
    );
    console.log("PG-U04-05 SUPER_ADMIN creation interdite PASS");

    const pending = await store.provisionUser(
      {
        firstName: "Pending",
        lastName: "Pg",
        email: "u04.pg.pending@test.local",
        temporaryPassword: "SchoolPending!2026",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
      },
      COUNTRY_ADMIN,
      AUDIT,
    );
    const pendingBefore = await pool.query(`SELECT status, profile_payload FROM users WHERE id = $1`, [pending.id]);
    assert.equal(pendingBefore.rows[0].status, "pending_validation");
    await expectRejection(
      store.updateUser(pending.id, { status: "Actif", validationStatus: "Validé" }, COUNTRY_ADMIN, AUDIT),
      { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
    );
    await store.updateUser(
      pending.id,
      { status: "Actif", validationStatus: "Validé", validatedBy: "superadmin", validatedAt: new Date().toISOString() },
      SUPER_ADMIN,
      AUDIT,
    );
    const pendingAfter = await pool.query(`SELECT status, profile_payload FROM users WHERE id = $1`, [pending.id]);
    assert.equal(pendingAfter.rows[0].status, "active");
    assert.equal(pendingAfter.rows[0].profile_payload.validationStatus, "Validé");
    console.log("PG-U04-07 validation pending persiste PASS");

    const refused = await store.provisionUser(
      {
        firstName: "Refuse",
        lastName: "Pg",
        email: "u04.pg.refuse@test.local",
        temporaryPassword: "SchoolPending!2026",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
      },
      COUNTRY_ADMIN,
      AUDIT,
    );
    await store.updateUser(refused.id, { status: "Archivé" }, SUPER_ADMIN, AUDIT);
    const refusedPg = await pool.query(`SELECT status FROM users WHERE id = $1`, [refused.id]);
    assert.equal(refusedPg.rows[0].status, "archived");
    console.log("PG-U04-08 refus pending persiste PASS");

    await store.updateUser(school.id, { status: "Suspendu" }, SUPER_ADMIN, AUDIT);
    assert.equal((await pool.query(`SELECT status FROM users WHERE id = $1`, [school.id])).rows[0].status, "suspended");
    await store.updateUser(school.id, { status: "Actif" }, SUPER_ADMIN, AUDIT);
    assert.equal((await pool.query(`SELECT status FROM users WHERE id = $1`, [school.id])).rows[0].status, "active");
    console.log("PG-U04-09/10 suspension/réactivation PASS");

    await expectRejection(
      store.reassignUserSchool(school.id, { schoolCode: "BI-2026-0001", countryCode: "BI" }, COUNTRY_ADMIN, AUDIT),
      { status: 403, code: CLIENTS_ERROR.TENANT_MISMATCH },
    );
    await store.reassignUserSchool(school.id, { schoolCode: "CD-2026-0002", countryCode: "CD" }, SUPER_ADMIN, AUDIT);
    const moved = await pool.query(
      `SELECT s.school_code, ur.school_id = u.school_id AS role_aligned
         FROM users u
         JOIN schools s ON s.id = u.school_id
         JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
        WHERE u.id = $1`,
      [school.id],
    );
    assert.equal(moved.rows[0].school_code, "CD-2026-0002");
    assert.equal(moved.rows[0].role_aligned, true);
    console.log("PG-U04-13/14 reassign + cross-tenant PASS");

    const beforeReset = await pool.query(
      `SELECT password_hash, must_change_password, email FROM users WHERE id = $1`,
      [school.id],
    );
    await pool.query(
      `INSERT INTO sessions (user_id, session_code, refresh_token_hash, role, expires_at)
       VALUES ($1, gen_random_uuid(), $2, 'SCHOOL_ADMIN', NOW() + INTERVAL '1 day')`,
      [school.id, `refresh-${school.id}`],
    );
    await pool.query(
      `INSERT INTO login_lockouts (school_scope, identifier_normalized, failed_attempts, locked_until)
       VALUES ('*', $1, 8, NOW() + INTERVAL '1 hour')`,
      [String(beforeReset.rows[0].email).toLowerCase()],
    );
    const secret = hashSecret("ResetTmp!2026");
    await pool.query(
      `UPDATE users
          SET password_hash = $1, pin_hash = $1, must_change_password = TRUE, updated_at = NOW()
        WHERE id = $2`,
      [secret, school.id],
    );
    await store.withTransaction((tx) => tx.revokeUserSessions(school.id, "password_reset"));
    await pool.query(`DELETE FROM login_lockouts WHERE identifier_normalized = $1`, [
      String(beforeReset.rows[0].email).toLowerCase(),
    ]);
    const afterReset = await pool.query(
      `SELECT password_hash, pin_hash, must_change_password FROM users WHERE id = $1`,
      [school.id],
    );
    assert.equal(afterReset.rows[0].must_change_password, true);
    assert.notEqual(afterReset.rows[0].password_hash, beforeReset.rows[0].password_hash);
    assert.equal(afterReset.rows[0].password_hash, afterReset.rows[0].pin_hash);
    const sessions = await pool.query(
      `SELECT revoked_at IS NOT NULL AS revoked, revoke_reason FROM sessions WHERE user_id = $1`,
      [school.id],
    );
    assert.ok(sessions.rows.every((row) => row.revoked && row.revoke_reason === "password_reset"));
    const lockouts = await pool.query(`SELECT count(*)::int AS n FROM login_lockouts WHERE identifier_normalized = $1`, [
      String(beforeReset.rows[0].email).toLowerCase(),
    ]);
    assert.equal(lockouts.rows[0].n, 0);
    console.log("PG-U04-15/16 reset + sessions + lockouts PASS");

    const audits = await pool.query(
      `SELECT action, old_value, new_value FROM audit_logs
        WHERE entity_id = $1::text OR entity_id = $1::uuid::text`,
      [school.id],
    );
    const blob = JSON.stringify(audits.rows);
    assert.doesNotMatch(blob, /ResetTmp!2026|CountryAdmin!2026|password_hash|pin_hash|temporaryPassword/);
    console.log("PG-U04-17 audit sans secret PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
