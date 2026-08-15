"use strict";

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { LOGIN_LOCKOUTS_SCHEMA_SQL } = require("../db/loginLockoutSchema");
const { createLoginLockoutPgStore } = require("../db/loginLockoutPgStore");
const {
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOGIN_LOCK_DURATION_MS,
  getLoginAttemptKey,
  parseLoginAttemptKey,
} = require("./loginLockout");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_LOGIN_LOCKOUT_IT_DATABASE ?? "somafrik_login_lockout_it")
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
  return {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
  };
}

function identity(schoolScope, identifier) {
  const parsed = parseLoginAttemptKey(getLoginAttemptKey(schoolScope, identifier));
  return parsed;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("loginLockout.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await pool.query(`
      CREATE TABLE countries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        iso_code VARCHAR(8) NOT NULL UNIQUE,
        phone_code VARCHAR(16) NOT NULL DEFAULT '+243',
        currency VARCHAR(16) NOT NULL DEFAULT 'CDF'
      );
      CREATE TABLE schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_id UUID NOT NULL REFERENCES countries(id),
        school_code VARCHAR(32) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);
    await pool.query(LOGIN_LOCKOUTS_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name) VALUES ($1, 'SCHOOL-A', 'A'), ($1, 'SCHOOL-B', 'B')`,
      [country.rows[0].id],
    );

    const repo = createRepo(pool);
    const storeA = createLoginLockoutPgStore(repo, {
      maxFailedAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockDurationMs: LOGIN_LOCK_DURATION_MS,
    });
    const storeB = createLoginLockoutPgStore(repo, {
      maxFailedAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockDurationMs: LOGIN_LOCK_DURATION_MS,
    });

    const idFirst = identity("SCHOOL-A", "admin@test.cd");
    await storeA.recordLoginFailure(idFirst);
    let row = await storeA.getLoginLockout(idFirst);
    assert.equal(row.failedAttempts, 1);

    await storeA.recordLoginFailure(idFirst);
    row = await storeA.getLoginLockout(idFirst);
    assert.equal(row.failedAttempts, 2);

    for (let i = 0; i < 3; i += 1) await storeA.recordLoginFailure(idFirst);
    row = await storeA.getLoginLockout(idFirst);
    assert.equal(row.failedAttempts, 5);
    assert.ok(row.lockedUntil > Date.now());
    await assert.rejects(() => storeA.assertLoginAllowed(idFirst), (error) => error.message === "LOCKED");

    await storeA.clearLoginLockout(idFirst);
    await storeA.assertLoginAllowed(idFirst);

    // Expiration : verrou dans le passé → lazy reset.
    const idExp = identity("SCHOOL-A", "expire@test.cd");
    for (let i = 0; i < 5; i += 1) await storeA.recordLoginFailure(idExp);
    await pool.query(
      `UPDATE login_lockouts SET locked_until = NOW() - INTERVAL '1 second'
       WHERE school_scope = $1 AND identifier_normalized = $2`,
      [idExp.schoolScope, idExp.identifierNormalized],
    );
    await storeA.assertLoginAllowed(idExp);
    assert.equal(await storeA.getLoginLockout(idExp), null);

    // Succès → DELETE
    const idClear = identity("SCHOOL-A", "ok@test.cd");
    await storeA.recordLoginFailure(idClear);
    await storeA.clearLoginLockout(idClear);
    assert.equal(await storeA.getLoginLockout(idClear), null);

    // Restart : instance 1 verrouille, instance 2 voit le lock.
    const idRestart = identity("SCHOOL-A", "restart@test.cd");
    for (let i = 0; i < 5; i += 1) await storeA.recordLoginFailure(idRestart);
    await assert.rejects(() => storeB.assertLoginAllowed(idRestart), (error) => error.message === "LOCKED");

    // Multi-instance : 3 + 2 = lock
    const idMulti = identity("SCHOOL-A", "multi@test.cd");
    await storeA.recordLoginFailure(idMulti);
    await storeA.recordLoginFailure(idMulti);
    await storeA.recordLoginFailure(idMulti);
    await storeB.recordLoginFailure(idMulti);
    await storeB.recordLoginFailure(idMulti);
    row = await storeA.getLoginLockout(idMulti);
    assert.equal(row.failedAttempts, 5);
    await assert.rejects(() => storeB.assertLoginAllowed(idMulti), (error) => error.message === "LOCKED");

    // Concurrence : deux échecs simultanés → +2
    const idConc = identity("SCHOOL-A", "race@test.cd");
    await Promise.all([storeA.recordLoginFailure(idConc), storeB.recordLoginFailure(idConc)]);
    row = await storeA.getLoginLockout(idConc);
    assert.equal(row.failedAttempts, 2);

    // Tenant isolation
    const phoneA = identity("SCHOOL-A", "0612345678");
    const phoneB = identity("SCHOOL-B", "0612345678");
    for (let i = 0; i < 5; i += 1) await storeA.recordLoginFailure(phoneA);
    await assert.rejects(() => storeA.assertLoginAllowed(phoneA), (error) => error.message === "LOCKED");
    await storeB.assertLoginAllowed(phoneB);

    // Plateforme
    const platform = identity("", "superadmin@somafrik.app");
    assert.equal(platform.schoolScope, "*");
    for (let i = 0; i < 5; i += 1) await storeA.recordLoginFailure(platform);
    await assert.rejects(() => storeB.assertLoginAllowed(platform), (error) => error.message === "LOCKED");
    await storeA.assertLoginAllowed(identity("SCHOOL-A", "superadmin@somafrik.app"));

    // Identifiant normalisé
    const mixed = identity("school-a", "Admin@TEST.cd");
    await storeA.recordLoginFailure(mixed);
    row = await storeA.getLoginLockout(identity("SCHOOL-A", "admin@test.cd"));
    assert.equal(row.failedAttempts, 1);

    console.log("loginLockout.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
