"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const { LOGIN_LOCKOUTS_SCHEMA_SQL } = require("../db/loginLockoutSchema");
const { GENERIC_AUTH_ERROR } = require("../lib/userAccountRules");
const { MAX_FAILED_LOGIN_ATTEMPTS } = require("../lib/loginLockout");

const ROOT = path.resolve(__dirname, "../..");
const MEMORY_PORT = 19728;
const PG_PORT = 19729;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_LOGIN_LOCKOUT_HTTP_IT_DATABASE ?? "somafrik_login_lockout_http_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function baseUrl(port) {
  return `http://127.0.0.1:${port}/api`;
}

async function request(port, pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl(port)}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function waitForHealth(child, port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl(port)}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

async function login(port, identifier, password, schoolCode) {
  return request(port, "/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
}

function assertGenericAuthFailure(result) {
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data?.message, GENERIC_AUTH_ERROR);
}

function assertLocked(result) {
  assert.equal(result.status, 423, JSON.stringify(result.data));
  assert.match(String(result.data?.message ?? ""), /15 minutes/);
}

async function runLockoutHttpSuite(port, { adminA, adminB, goodPassword }) {
  const unknown = await login(port, "nobody@test.cd", "wrong", adminA.schoolCode);
  assertGenericAuthFailure(unknown);

  const bad = await login(port, adminA.identifier, "bad-password", adminA.schoolCode);
  assertGenericAuthFailure(bad);
  assert.equal(bad.data?.message, unknown.data?.message);

  const good = await login(port, adminA.identifier, goodPassword, adminA.schoolCode);
  assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.ok(good.data?.accessToken || good.data?.token);

  for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
    assertGenericAuthFailure(await login(port, adminA.identifier, "bad-password", adminA.schoolCode));
  }
  assertLocked(await login(port, adminA.identifier, "bad-password", adminA.schoolCode));
  const sixthGood = await login(port, adminA.identifier, goodPassword, adminA.schoolCode);
  assertLocked(sixthGood);

  if (adminB) {
    const other = await login(port, adminB.identifier, goodPassword, adminB.schoolCode);
    assert.equal(other.status, 200, JSON.stringify(other.data));
  }
}

async function runMemorySuite() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(MEMORY_PORT),
      NODE_ENV: "development",
      DATABASE_URL: "",
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "false",
      SOMAFRIK_E2E: "false",
      LOGIN_RATE_LIMIT_MAX: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, MEMORY_PORT);
    const missing = await request(MEMORY_PORT, "/backoffice/e2e/clear-login-lockout", { method: "POST" });
    assert.equal(missing.status, 404);

    await runLockoutHttpSuite(MEMORY_PORT, {
      adminA: { identifier: "admin", schoolCode: "CD-2026-0001" },
      adminB: { identifier: "admin", schoolCode: "BI-2026-0002" },
      goodPassword: "1234",
    });
  } finally {
    child.kill("SIGTERM");
  }
}

async function preparePgHttpDatabase(databaseUrl) {
  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, PG_HTTP_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret("1234");
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(LOGIN_LOCKOUTS_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'BI-2026-0002', 'Lycée B', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-A', 'Admin', 'A', 'admin-a@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-B', 'Admin', 'B', 'admin-b@test.bi', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolB.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES (NULL, 'SUPER-1', 'Super', 'Admin', 'superadmin@test.cd', $1, $1, 'SUPER_ADMIN', 'active')`,
      [passwordHash],
    );
    return { isolatedUrl, schoolA: schoolA.rows[0].id };
  } finally {
    await pool.end();
  }
}

async function runPgSuite(databaseUrl) {
  const prepared = await preparePgHttpDatabase(databaseUrl);
  const child = spawn("node", ["backend/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PG_PORT),
      NODE_ENV: "test",
      DATABASE_URL: prepared.isolatedUrl,
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "false",
      SOMAFRIK_E2E: "false",
      LOGIN_RATE_LIMIT_MAX: "100",
      JWT_SECRET: "ci-test-secret-with-enough-length-for-production-checks",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, PG_PORT);
    const missing = await request(PG_PORT, "/backoffice/e2e/clear-login-lockout", { method: "POST" });
    assert.equal(missing.status, 404);

    await runLockoutHttpSuite(PG_PORT, {
      adminA: { identifier: "admin-a@test.cd", schoolCode: "CD-2026-0001" },
      adminB: { identifier: "admin-b@test.bi", schoolCode: "BI-2026-0002" },
      goodPassword: "1234",
    });

    const expirePool = new Pool({ connectionString: prepared.isolatedUrl });
    try {
      await expirePool.query(
        `UPDATE login_lockouts SET locked_until = NOW() - INTERVAL '1 second'
         WHERE identifier_normalized = $1`,
        ["admin-a@test.cd"],
      );
    } finally {
      await expirePool.end();
    }
    const afterExpiry = await login(PG_PORT, "admin-a@test.cd", "1234", "CD-2026-0001");
    assert.equal(afterExpiry.status, 200, JSON.stringify(afterExpiry.data));
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  await runMemorySuite();
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    console.log("verify-login-lockout-management: mémoire OK, PG SKIP");
    return;
  }
  await runPgSuite(databaseUrl);
  console.log("verify-login-lockout-management: SUCCESS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
