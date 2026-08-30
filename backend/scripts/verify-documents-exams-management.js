"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");
const { DOCUMENTS_EXAMS_ERROR } = require("../lib/documentsExamsManagement");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { DOCUMENTS_EXAMS_SCHEMA_SQL } = require("../db/documentsExamsSchema");

const ROOT = path.resolve(__dirname, "../..");
const MEMORY_PORT = 19726;
const PG_PORT = 19727;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_DOCUMENTS_EXAMS_HTTP_IT_DATABASE ?? "somafrik_documents_exams_http_it")
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

const examPayload = {
  name: "Contrôle LOT5",
  className: "6ème A",
  subject: "Mathématiques",
  date: "2026-06-10",
  period: "Trimestre 1",
};

async function runMemorySuite() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(MEMORY_PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child, MEMORY_PORT);
    const unauth = await request(MEMORY_PORT, "/exams");
    assert.equal(unauth.status, 401);

    const adminToken = await login(MEMORY_PORT, "admin", "1234", "CD-IN-26-001");
    const adminBi = await login(MEMORY_PORT, "admin", "1234", "BI-ESB-26-001");
    const teacherToken = await login(MEMORY_PORT, "CD-IN-JK-26-00001", "1234", "CD-IN-26-001");

    assertLegacyForbidden(
      await request(MEMORY_PORT, "/backoffice/planning-exams", { method: "PUT", token: adminToken, body: { exams: [] } }),
      DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_WRITE_FORBIDDEN,
    );
    assertLegacyForbidden(
      await request(MEMORY_PORT, "/backoffice/report-cards", { method: "PUT", token: adminToken, body: { bulletins: [] } }),
      DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_WRITE_FORBIDDEN,
    );
    assertLegacyForbidden(
      await request(MEMORY_PORT, "/backoffice/establishment-documents", {
        method: "PUT",
        token: adminToken,
        body: { documents: [] },
      }),
      DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_WRITE_FORBIDDEN,
    );

    const teacherWrite = await request(MEMORY_PORT, "/exams", { method: "POST", token: teacherToken, body: examPayload });
    assert.equal(teacherWrite.status, 403, JSON.stringify(teacherWrite.data));

    const created = await request(MEMORY_PORT, "/exams", {
      method: "POST",
      token: adminToken,
      body: { ...examPayload, schoolCode: "BI-2026-0002", schoolId: "ignore" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.schoolCode, "CD-IN-26-001");
    assert.equal(created.data.className, "6ème A");

    const duplicate = await request(MEMORY_PORT, "/exams", { method: "POST", token: adminToken, body: examPayload });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));

    const validated = await request(MEMORY_PORT, `/exams/${created.data.id}/validate`, { method: "POST", token: adminToken });
    assert.equal(validated.status, 200, JSON.stringify(validated.data));
    assert.equal(validated.data.statusCode, "validated");

    const cancelled = await request(MEMORY_PORT, `/exams/${created.data.id}/cancel`, { method: "POST", token: adminToken });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.statusCode, "cancelled");

    const archived = await request(MEMORY_PORT, `/exams/${created.data.id}/archive`, { method: "POST", token: adminToken });
    assert.equal(archived.status, 200);

    const foreign = await request(MEMORY_PORT, `/exams/${created.data.id}`, { token: adminBi });
    assert.equal(foreign.status, 404, JSON.stringify(foreign.data));

    const spoofGet = await request(MEMORY_PORT, "/exams", { token: adminBi });
    assert.equal(spoofGet.status, 200);
    assert.equal((spoofGet.data.exams ?? []).some((row) => row.id === created.data.id), false);

    const bulletin = await request(MEMORY_PORT, "/report-cards/generate", {
      method: "POST",
      token: adminToken,
      body: { studentId: "1", period: "Trimestre 1", className: "6ème A" },
    });
    assert.equal(bulletin.status, 201, JSON.stringify(bulletin.data));
    const published = await request(MEMORY_PORT, `/report-cards/${bulletin.data.id}/publish`, {
      method: "POST",
      token: adminToken,
    });
    assert.equal(published.status, 200);
    await request(MEMORY_PORT, `/report-cards/${bulletin.data.id}/archive`, { method: "POST", token: adminToken });

    const template = await request(MEMORY_PORT, "/report-card-templates", {
      method: "PUT",
      token: adminToken,
      body: { className: "6ème A", layout: { reportTitle: "Bulletin 6A", showRank: true } },
    });
    assert.equal(template.status, 200, JSON.stringify(template.data));
    const badLayout = await request(MEMORY_PORT, "/report-card-templates", {
      method: "PUT",
      token: adminToken,
      body: { layout: { grades: [12] } },
    });
    assert.equal(badLayout.status, 400);

    const document = await request(MEMORY_PORT, "/school-documents", {
      method: "POST",
      token: adminToken,
      body: { title: "Attestation LOT5", documentType: "attestation" },
    });
    assert.equal(document.status, 201, JSON.stringify(document.data));
    await request(MEMORY_PORT, `/school-documents/${document.data.id}/archive`, { method: "POST", token: adminToken });

    const teacherLegacyPut = await request(MEMORY_PORT, "/backoffice/planning-exams", {
      method: "PUT",
      token: teacherToken,
      body: { exams: [] },
    });
    assert.equal(teacherLegacyPut.status, 403);
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
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/migrations/20260814_residual_state_canonical.sql"), "utf8"));
    await pool.query(DOCUMENTS_EXAMS_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status) VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'Lycée HTTP', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status) VALUES ($1, 'BI-2026-0002', 'BI-ESB-26-001', 'Lycée B', 'active') RETURNING id`,
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
    await pool.query(`INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`, [
      year.rows[0].id,
    ]);
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'CD-IN-AD-26-00001', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'BI-ESB-AD-26-00001', 'Admin', 'BI', 'admin-bi@test.bi', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolB.rows[0].id, passwordHash],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'CD-IN-ET-26-00001', 'Paul', 'Prof', 'ens-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1, $2, 'ENS-0001', 'active')`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
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
    const adminToken = await login(PG_PORT, "admin-http@test.cd", "1234", "CD-IN-26-001");
    const adminBi = await login(PG_PORT, "admin-bi@test.bi", "1234", "BI-ESB-26-001");
    const teacherToken = await login(PG_PORT, "ens-http@test.cd", "1234", "CD-IN-26-001");

    assertLegacyForbidden(
      await request(PG_PORT, "/backoffice/planning-exams", { method: "PUT", token: adminToken, body: { exams: [{ id: "x" }] } }),
      DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_WRITE_FORBIDDEN,
    );

    const teacherWrite = await request(PG_PORT, "/exams", { method: "POST", token: teacherToken, body: examPayload });
    assert.ok([403, 401].includes(teacherWrite.status), JSON.stringify(teacherWrite.data));

    const created = await request(PG_PORT, "/exams", {
      method: "POST",
      token: adminToken,
      body: { ...examPayload, schoolCode: "BI-2026-0002" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.schoolCode, "CD-IN-26-001");
    assert.equal(created.data.subject, "Mathématiques");

    const duplicate = await request(PG_PORT, "/exams", { method: "POST", token: adminToken, body: examPayload });
    assert.equal(duplicate.status, 409);

    const foreignUuid = await request(PG_PORT, `/exams/${created.data.id}`, { token: adminBi });
    assert.equal(foreignUuid.status, 404);

    const missingClass = await request(PG_PORT, "/exams", {
      method: "POST",
      token: adminToken,
      body: { ...examPayload, className: "Classe inventée", date: "2026-06-11" },
    });
    assert.equal(missingClass.status, 404);

    const document = await request(PG_PORT, "/school-documents", {
      method: "POST",
      token: adminToken,
      body: { title: "Attestation PG", documentType: "attestation" },
    });
    assert.equal(document.status, 201, JSON.stringify(document.data));
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  const schemaSource = fs.readFileSync(path.join(ROOT, "backend/db/documentsExamsSchema.js"), "utf8");
  const serviceSource = fs.readFileSync(path.join(ROOT, "backend/lib/documentsExamsService.js"), "utf8");
  const migrationSource = fs.readFileSync(
    path.join(ROOT, "backend/db/migrations/20260819_exams_report_cards_documents_canonical.sql"),
    "utf8",
  );
  assert.match(schemaSource, /DOCUMENTS_EXAMS_SCHEMA_DDL_SQL/);
  assert.match(schemaSource, /DOCUMENTS_EXAMS_DATA_NORMALIZATION_SQL/);
  assert.equal(schemaSource.includes("status NOT IN"), false);
  assert.equal(migrationSource.includes("status NOT IN"), false);
  const bootFn = serviceSource.slice(serviceSource.indexOf("async function runDocumentsExamsCanonicalBoot"));
  const inventoryAt = bootFn.indexOf("ensureDocumentsExamsConstraints");
  const statusAt = bootFn.indexOf("ensureExamStatusesDeterministic");
  const ddlAt = bootFn.indexOf("repo.query(DOCUMENTS_EXAMS_SCHEMA_DDL_SQL)");
  const normAt = bootFn.indexOf("repo.query(DOCUMENTS_EXAMS_DATA_NORMALIZATION_SQL)");
  assert.ok(inventoryAt >= 0 && inventoryAt < ddlAt, "inventaire residual avant DDL");
  assert.ok(statusAt >= 0 && statusAt < ddlAt, "inventaire statuts avant DDL");
  assert.ok(ddlAt >= 0 && ddlAt < normAt, "DDL avant normalisation");

  await runMemorySuite();
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    await runPgSuite(databaseUrl);
  } else {
    console.log("verify-documents-exams-management.js PG HTTP SKIP (DATABASE_URL absent)");
  }
  console.log("verify-documents-exams-management.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
