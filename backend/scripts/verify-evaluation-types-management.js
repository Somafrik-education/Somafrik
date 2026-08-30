"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const { EVALUATION_TYPES_ERROR } = require("../lib/evaluationTypesManagement");
const { EVALUATION_TYPES_SCHEMA_SQL } = require("../db/evaluationTypesSchema");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");

const ROOT = path.resolve(__dirname, "../..");
const MEMORY_PORT = 19722;
const PG_PORT = 19723;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_EVALUATION_TYPES_HTTP_IT_DATABASE ?? "somafrik_evaluation_types_http_it")
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

async function runMemorySuite() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(MEMORY_PORT), NODE_ENV: "development", SOMAFRIK_DB_REQUIRED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, MEMORY_PORT);
    const unauth = await request(MEMORY_PORT, "/evaluation-types");
    assert.equal(unauth.status, 401);

    const superToken = await login(MEMORY_PORT, "superadmin", "1234");
    const adminToken = await login(MEMORY_PORT, "admin", "1234", "CD-IN-26-001");
    const adminBi = await login(MEMORY_PORT, "admin", "1234", "BI-ESB-26-001");
    const teacherToken = await login(MEMORY_PORT, "CD-IN-JK-26-00001", "1234", "CD-IN-26-001");

    const list = await request(MEMORY_PORT, "/evaluation-types", { token: adminToken });
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.ok(Array.isArray(list.data.types));
    assert.ok(list.data.types.some((row) => row.code === "devoir"));

    const created = await request(MEMORY_PORT, "/evaluation-types", {
      method: "POST",
      token: adminToken,
      body: { name: "Oral", code: "oral", schoolId: "ignore-me", schoolCode: "BI-ESB-26-001" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.schoolCode, "CD-IN-26-001");
    assert.equal(created.data.code, "oral");

    const patched = await request(MEMORY_PORT, `/evaluation-types/${encodeURIComponent(created.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { name: "Oral blanc", displayOrder: 90, schoolCode: "BI-ESB-26-001" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.name, "Oral blanc");

    const teacherWrite = await request(MEMORY_PORT, "/evaluation-types", {
      method: "POST",
      token: teacherToken,
      body: { name: "Interdit", code: "interdit" },
    });
    assert.equal(teacherWrite.status, 403, JSON.stringify(teacherWrite.data));

    const teacherRead = await request(MEMORY_PORT, "/evaluation-types", { token: teacherToken });
    assert.equal(teacherRead.status, 200, JSON.stringify(teacherRead.data));

    const biList = await request(MEMORY_PORT, "/evaluation-types", { token: adminBi });
    assert.equal(biList.status, 200, JSON.stringify(biList.data));
    assert.equal(
      (biList.data.types ?? []).some((row) => row.id === created.data.id),
      false,
      "isolation tenant lecture",
    );

    const biPatch = await request(MEMORY_PORT, `/evaluation-types/${encodeURIComponent(created.data.id)}`, {
      method: "PATCH",
      token: adminBi,
      body: { name: "Compromis" },
    });
    assert.equal(biPatch.status, 404, JSON.stringify(biPatch.data));

    const archived = await request(MEMORY_PORT, `/evaluation-types/${encodeURIComponent(created.data.id)}/archive`, {
      method: "POST",
      token: adminToken,
      body: {},
    });
    assert.equal(archived.status, 200, JSON.stringify(archived.data));
    assert.equal(archived.data.status, "archived");

    const unknown = await request(MEMORY_PORT, "/evaluation-types/00000000-0000-4000-8000-000000000099", {
      method: "PATCH",
      token: adminToken,
      body: { name: "X" },
    });
    assert.equal(unknown.status, 404);

    const legacyPut = await request(MEMORY_PORT, "/academic-config", {
      method: "PUT",
      token: adminToken,
      body: { evaluationTypes: ["legacy"] },
    });
    assert.equal(legacyPut.status, 400, JSON.stringify(legacyPut.data));
    assert.equal(legacyPut.data?.code, EVALUATION_TYPES_ERROR.LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN);

    const projection = await request(MEMORY_PORT, "/academic-config", { token: adminToken });
    assert.equal(projection.status, 200);
    assert.ok(Array.isArray(projection.data.evaluationTypes));
    assert.equal(projection.data.evaluationTypes.includes("Oral blanc"), false);

    const superBackoffice = await request(MEMORY_PORT, "/backoffice/establishments/CD-IN-26-001/evaluation-types", {
      token: superToken,
    });
    assert.equal(superBackoffice.status, 200, JSON.stringify(superBackoffice.data));
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
    await pool.query(EVALUATION_TYPES_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status) VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'Lycée HTTP', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status) VALUES ($1, 'BI-2026-0002', 'BI-LB-26-001', 'Lycée B', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const math = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'CD-IN-AD-26-00001', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'CD-IN-ET-26-00001', 'Paul', 'Prof', 'ens-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1, $2, 'ENS-0001', 'active') RETURNING id`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [schoolA.rows[0].id, teacher.rows[0].id, klass.rows[0].id, math.rows[0].id, year.rows[0].id],
    );
    await pool.query(`INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`, [
      year.rows[0].id,
    ]);
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2025-09-01')`,
      [schoolA.rows[0].id],
    );
    const typeA = await pool.query(
      `INSERT INTO evaluation_types (school_id, code, name, display_order, status)
       VALUES ($1, 'devoir', 'Devoir', 20, 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const typeB = await pool.query(
      `INSERT INTO evaluation_types (school_id, code, name, display_order, status)
       VALUES ($1, 'devoir', 'Devoir', 20, 'active') RETURNING id`,
      [schoolB.rows[0].id],
    );
    const archived = await pool.query(
      `INSERT INTO evaluation_types (school_id, code, name, display_order, status)
       VALUES ($1, 'oral', 'Oral', 90, 'archived') RETURNING id`,
      [schoolA.rows[0].id],
    );
    return {
      isolatedUrl,
      typeAId: typeA.rows[0].id,
      typeBId: typeB.rows[0].id,
      archivedId: archived.rows[0].id,
    };
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
    // POST /evaluations = Notes:CREATE. Admin School n'a que Modifier notes (UPDATE).
    const teacherToken = await login(PG_PORT, "ens-http@test.cd", "1234", "CD-IN-26-001");

    const createdEval = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Devoir canonique",
        teacherId: "CD-IN-ET-26-00001",
        evaluationTypeId: prepared.typeAId,
        schoolCode: "BI-ESB-26-001",
        scale: 20,
      },
    });
    assert.equal(createdEval.status, 201, JSON.stringify(createdEval.data));
    assert.equal(createdEval.data.evaluationTypeId, prepared.typeAId);

    const missingType = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Évaluation",
        teacherId: "CD-IN-ET-26-00001",
        scale: 20,
      },
    });
    assert.equal(missingType.status, 400, JSON.stringify(missingType.data));
    assert.equal(missingType.data?.code, EVALUATION_TYPES_ERROR.EVALUATION_TYPE_REQUIRED);

    const foreignType = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Type étranger",
        teacherId: "CD-IN-ET-26-00001",
        evaluationTypeId: prepared.typeBId,
        scale: 20,
      },
    });
    assert.equal(foreignType.status, 404, JSON.stringify(foreignType.data));
    assert.equal(foreignType.data?.code, EVALUATION_TYPES_ERROR.TYPE_NOT_FOUND);

    const invented = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Type inventé",
        teacherId: "CD-IN-ET-26-00001",
        evaluationType: "Quiz surprise",
        scale: 20,
      },
    });
    assert.equal(invented.status, 404, JSON.stringify(invented.data));

    const archived = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Type archivé",
        teacherId: "CD-IN-ET-26-00001",
        evaluationTypeId: prepared.archivedId,
        scale: 20,
      },
    });
    assert.equal(archived.status, 409, JSON.stringify(archived.data));
    assert.equal(archived.data?.code, EVALUATION_TYPES_ERROR.TYPE_ARCHIVED);
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
    console.log("verify-evaluation-types-management.js PG HTTP SKIP (DATABASE_URL absent)");
  }
  console.log("verify-evaluation-types-management.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
