"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const { DATA_EXPORT_FORMAT, DATA_EXPORT_VERSION } = require("../lib/dataExportManagement");
const { collectSensitiveExportPaths } = require("../lib/dataExportManagement");

const ROOT = path.resolve(__dirname, "../..");
const MEMORY_PORT = 19730;
const PG_PORT = 19731;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_DATA_EXPORT_HTTP_IT_DATABASE ?? "somafrik_data_export_http_it")
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
  const result = await request(port, "/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.accessToken || result.data.token;
}

function assertExportEnvelope(payload, schoolCode) {
  assert.equal(payload.format, DATA_EXPORT_FORMAT);
  assert.equal(payload.version, DATA_EXPORT_VERSION);
  assert.equal(payload.schoolCode, schoolCode);
  assert.ok(Array.isArray(payload.includedDomains));
  assert.ok(payload.domains && typeof payload.domains === "object");
  for (const domain of payload.includedDomains) {
    assert.equal(domain in payload.domains, true, `domaine annoncé absent: ${domain}`);
  }
  assert.equal("payments" in payload.domains, false);
  assert.equal("notes" in payload.domains, false);
  assert.deepEqual(collectSensitiveExportPaths(payload), []);
}

async function runExportHttpSuite(port, { admin, otherAdmin, teacher, superadmin }) {
  const unauth = await request(port, "/data-export");
  assert.equal(unauth.status, 401);

  const adminToken = await login(port, admin.identifier, admin.password, admin.schoolCode);
  const exported = await request(port, "/data-export", { token: adminToken });
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assertExportEnvelope(exported.data, admin.schoolCode);

  const spoof = await request(port, `/data-export?schoolCode=${encodeURIComponent(otherAdmin.schoolCode)}`, {
    token: adminToken,
  });
  assert.equal(spoof.status, 200, JSON.stringify(spoof.data));
  assert.equal(spoof.data.schoolCode, admin.schoolCode);

  const teacherToken = await login(port, teacher.identifier, teacher.password, teacher.schoolCode);
  const teacherExport = await request(port, "/data-export", { token: teacherToken });
  assert.equal(teacherExport.status, 403);

  const otherToken = await login(port, otherAdmin.identifier, otherAdmin.password, otherAdmin.schoolCode);
  const otherExport = await request(port, "/data-export", { token: otherToken });
  assert.equal(otherExport.status, 200, JSON.stringify(otherExport.data));
  assert.equal(otherExport.data.schoolCode, otherAdmin.schoolCode);

  if (superadmin) {
    const superToken = await login(port, superadmin.identifier, superadmin.password);
    const missingSchool = await request(port, "/data-export", { token: superToken });
    assert.equal(missingSchool.status, 403, JSON.stringify(missingSchool.data));
    const superExport = await request(port, `/data-export?schoolCode=${encodeURIComponent(admin.schoolCode)}`, {
      token: superToken,
    });
    assert.equal(superExport.status, 403, JSON.stringify(superExport.data));
  }

  const gone = await request(port, "/backoffice/state", { method: "PUT", token: adminToken, body: { students: [] } });
  assert.equal(gone.status, 410);
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
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, MEMORY_PORT);
    await runExportHttpSuite(MEMORY_PORT, {
      admin: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
      otherAdmin: { identifier: "admin", password: "1234", schoolCode: "BI-2026-0002" },
      teacher: { identifier: "ENS-0001", password: "1234", schoolCode: "CD-2026-0001" },
      superadmin: { identifier: "superadmin", password: "1234" },
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
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'CD-2026-0001', 'Lycée Export', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'BI-2026-0002', 'Lycée B', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active')`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-EXP-1', 'Amina', 'Export', 'active')`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-CD-EXP', 'Admin', 'Export', 'admin-export@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-BI-EXP', 'Admin', 'BI', 'admin-bi-export@test.bi', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolB.rows[0].id, passwordHash],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-EXP', 'Paul', 'Prof', 'ens-export@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1, $2, 'ENS-EXP', 'active')`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES (NULL, 'SUPER-EXP', 'Super', 'Admin', 'super-export@test.cd', $1, $1, 'SUPER_ADMIN', 'active')`,
      [passwordHash],
    );
    return { isolatedUrl };
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
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      JWT_SECRET: "ci-test-secret-with-enough-length-for-production-checks",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, PG_PORT);
    await runExportHttpSuite(PG_PORT, {
      admin: { identifier: "admin-export@test.cd", password: "1234", schoolCode: "CD-2026-0001" },
      otherAdmin: { identifier: "admin-bi-export@test.bi", password: "1234", schoolCode: "BI-2026-0002" },
      teacher: { identifier: "ens-export@test.cd", password: "1234", schoolCode: "CD-2026-0001" },
      superadmin: { identifier: "super-export@test.cd", password: "1234" },
    });

    const pool = new Pool({ connectionString: prepared.isolatedUrl });
    try {
      const audit = await pool.query(
        `SELECT action, new_value FROM audit_logs WHERE action = 'export_school_data' ORDER BY created_at DESC LIMIT 1`,
      );
      assert.ok(audit.rowCount > 0, "audit export_school_data manquant");
      const payload = audit.rows[0].new_value;
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      assert.equal(text.includes("password"), false);
      assert.equal(text.includes("Amina"), false);
    } finally {
      await pool.end();
    }
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  await runMemorySuite();
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    console.log("verify-data-export-safety: mémoire OK, PG SKIP");
    return;
  }
  await runPgSuite(databaseUrl);
  console.log("verify-data-export-safety: SUCCESS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
