"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const { SCHOOL_SETTINGS_ERROR } = require("../lib/schoolSettingsManagement");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { SCHOOL_SETTINGS_SCHEMA_SQL } = require("../db/schoolSettingsSchema");

const ROOT = path.resolve(__dirname, "../..");
const MEMORY_PORT = 19724;
const PG_PORT = 19725;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_SCHOOL_SETTINGS_HTTP_IT_DATABASE ?? "somafrik_school_settings_http_it")
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
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

function assertLegacyForbidden(result, expectedCode) {
  assert.equal(result.status, 400, JSON.stringify(result.data));
  assert.equal(result.data?.code, expectedCode, JSON.stringify(result.data));
}

async function runMemorySuite() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(MEMORY_PORT), NODE_ENV: "development", SOMAFRIK_DB_REQUIRED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, MEMORY_PORT);
    const unauth = await request(MEMORY_PORT, "/school-settings");
    assert.equal(unauth.status, 401);

    const superToken = await login(MEMORY_PORT, "superadmin", "1234");
    const adminToken = await login(MEMORY_PORT, "admin", "1234", "CD-2026-0001");
    const adminBi = await login(MEMORY_PORT, "admin", "1234", "BI-2026-0002");
    const teacherToken = await login(MEMORY_PORT, "ENS-0001", "1234", "CD-2026-0001");

    const list = await request(MEMORY_PORT, "/school-settings", { token: adminToken });
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.equal(list.data.schoolCode, "CD-2026-0001");
    assert.ok(list.data.periodMode);

    const patched = await request(MEMORY_PORT, "/school-settings", {
      method: "PATCH",
      token: adminToken,
      body: { periodMode: "semestre", defaultScale: 10, schoolCode: "BI-2026-0002", schoolId: "ignore-me" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.periodMode, "semestre");
    assert.equal(patched.data.defaultScale, 10);
    assert.equal(patched.data.schoolCode, "CD-2026-0001");

    const invalid = await request(MEMORY_PORT, "/school-settings", {
      method: "PATCH",
      token: adminToken,
      body: { defaultScale: 0 },
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.data));

    const teacherWrite = await request(MEMORY_PORT, "/school-settings", {
      method: "PATCH",
      token: teacherToken,
      body: { periodMode: "periode" },
    });
    assert.equal(teacherWrite.status, 403, JSON.stringify(teacherWrite.data));

    const biSettings = await request(MEMORY_PORT, "/school-settings", { token: adminBi });
    assert.equal(biSettings.status, 200, JSON.stringify(biSettings.data));
    assert.equal(biSettings.data.schoolCode, "BI-2026-0002");
    assert.notEqual(biSettings.data.periodMode, "semestre");

    const periods = await request(MEMORY_PORT, "/academic-periods", {
      method: "PUT",
      token: adminToken,
      body: {
        schoolCode: "BI-2026-0002",
        periods: [
          { name: "Semestre 1", startDate: "01-09-2025", endDate: "31-01-2026" },
          { name: "Semestre 2", startDate: "01-02-2026", endDate: "30-06-2026" },
        ],
      },
    });
    assert.equal(periods.status, 200, JSON.stringify(periods.data));
    assert.equal(periods.data.periods.length, 2);

    assertLegacyForbidden(
      await request(MEMORY_PORT, "/academic-config", {
        method: "PUT",
        token: adminToken,
        body: { periods: [] },
      }),
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN,
    );
    assertLegacyForbidden(
      await request(MEMORY_PORT, "/academic-config", {
        method: "PUT",
        token: adminToken,
        body: { periodMode: null },
      }),
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN,
    );
    assertLegacyForbidden(
      await request(MEMORY_PORT, "/academic-config", {
        method: "PUT",
        token: adminToken,
        body: { classNames: null },
      }),
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_CLASS_NAMES_WRITE_FORBIDDEN,
    );
    assertLegacyForbidden(
      await request(MEMORY_PORT, "/academic-config", {
        method: "PUT",
        token: adminToken,
        body: { defaultScale: 20 },
      }),
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN,
    );

    const projection = await request(MEMORY_PORT, "/academic-config", { token: adminToken });
    assert.equal(projection.status, 200, JSON.stringify(projection.data));
    assert.equal(projection.data.periodMode, "semestre");
    assert.equal(projection.data.defaultScale, 10);
    assert.equal(projection.data.periods.length, 2);
    assert.ok(Array.isArray(projection.data.levels));
    assert.ok(Array.isArray(projection.data.evaluationTypes));
    assert.equal("allowCustomClasses" in projection.data, false);

    const emptyPut = await request(MEMORY_PORT, "/academic-config", {
      method: "PUT",
      token: adminToken,
      body: {},
    });
    assert.equal(emptyPut.status, 200, JSON.stringify(emptyPut.data));
    assert.equal(emptyPut.data.periodMode, "semestre");

    const superBackoffice = await request(MEMORY_PORT, "/backoffice/establishments/CD-2026-0001/school-settings", {
      token: superToken,
    });
    assert.equal(superBackoffice.status, 200, JSON.stringify(superBackoffice.data));
    assert.equal(superBackoffice.data.periodMode, "semestre");
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
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    await pool.query(SCHOOL_SETTINGS_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'CD-2026-0001', 'Lycée HTTP', 'active') RETURNING id`,
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
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active')`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-CD-2026-0001-01', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-BI-2026-0002-01', 'Admin', 'BI', 'admin-bi@test.bi', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolB.rows[0].id, passwordHash],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-0001', 'Paul', 'Prof', 'ens-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1, $2, 'ENS-0001', 'active')`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
    await pool.query(`INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`, [
      year.rows[0].id,
    ]);
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2025-09-01')`,
      [schoolA.rows[0].id],
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
      JWT_SECRET: "ci-test-secret-with-enough-length-for-production-checks",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, PG_PORT);
    const adminToken = await login(PG_PORT, "admin-http@test.cd", "1234", "CD-2026-0001");
    const adminBi = await login(PG_PORT, "admin-bi@test.bi", "1234", "BI-2026-0002");
    const teacherToken = await login(PG_PORT, "ens-http@test.cd", "1234", "CD-2026-0001");

    const patched = await request(PG_PORT, "/school-settings", {
      method: "PATCH",
      token: adminToken,
      body: { periodMode: "semestre", defaultScale: 15, schoolCode: "BI-2026-0002" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.periodMode, "semestre");
    assert.equal(patched.data.defaultScale, 15);
    assert.equal(patched.data.schoolCode, "CD-2026-0001");

    const teacherWrite = await request(PG_PORT, "/school-settings", {
      method: "PATCH",
      token: teacherToken,
      body: { periodMode: "periode" },
    });
    assert.equal(teacherWrite.status, 403, JSON.stringify(teacherWrite.data));

    const biSettings = await request(PG_PORT, "/school-settings", { token: adminBi });
    assert.equal(biSettings.status, 200, JSON.stringify(biSettings.data));
    assert.equal(biSettings.data.periodMode, "trimestre");

    const projection = await request(PG_PORT, "/academic-config", { token: adminToken });
    assert.equal(projection.status, 200, JSON.stringify(projection.data));
    assert.equal(projection.data.periodMode, "semestre");
    assert.equal(projection.data.defaultScale, 15);
    assert.ok(projection.data.classNames.includes("6ème A"));
    assert.ok(projection.data.subjects.includes("Mathématiques"));

    assertLegacyForbidden(
      await request(PG_PORT, "/academic-config", {
        method: "PUT",
        token: adminToken,
        body: { periods: [{ name: "legacy" }] },
      }),
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN,
    );
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  await runMemorySuite();
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    await runPgSuite(databaseUrl);
  } else {
    console.log("verify-school-settings-management.js PG HTTP SKIP (DATABASE_URL absent)");
  }
  console.log("verify-school-settings-management.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
