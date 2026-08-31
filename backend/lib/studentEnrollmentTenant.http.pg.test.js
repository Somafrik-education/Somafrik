"use strict";

/**
 * SYNC-E2E-STUDENT-ENROLLMENT-TENANT-01 — POST /classes/:classCode/students
 * leftover JWT ≠ login_code : membership UUID, Finance via login_code V2.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { isV2SchoolLoginCode, isLegacySchoolCodeFormat } = require("./schoolCodeV2");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_ENROLL_TENANT_IT_DATABASE ?? "somafrik_enroll_tenant_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_ENROLL_TENANT_HTTP_PORT ?? 19883);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const CLASS_A = "CLS-ENROLL-A";
const CLASS_B = "CLS-ENROLL-B";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
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

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function mintAccess(tokens, claims) {
  return tokens.createAccessToken({
    typ: "access",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Élèves:CREATE", "Élèves:READ", "Gérer élèves"],
    ...claims,
  });
}

async function grantStudentsCreate(pool) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = 'SCHOOL_ADMIN' AND module_key = 'students'
       AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = TRUE, can_read = TRUE, can_update = TRUE, can_delete = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ('SCHOOL_ADMIN', 'global', 'students', TRUE, TRUE, TRUE, FALSE, 'enroll-tenant')`,
  );
}

async function seedSchool(pool, { countryName, iso, leftover, shortCode, name, classCode }) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [countryName, iso, iso === "CD" ? "+243" : "+257", iso === "CD" ? "CDF" : "BIF"],
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, short_code, name, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id, school_code, login_code`,
    [country.rows[0].id, leftover, shortCode, name],
  );
  const loginCode = String(school.rows[0].login_code ?? "").trim().toUpperCase();
  assert.ok(isV2SchoolLoginCode(loginCode), `login_code V2 attendu, reçu ${loginCode}`);
  assert.ok(isLegacySchoolCodeFormat(school.rows[0].school_code));
  assert.notEqual(school.rows[0].school_code, loginCode);
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [school.rows[0].id],
  );
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A', 'active')`,
    [school.rows[0].id, year.rows[0].id, classCode],
  );
  return { schoolId: school.rows[0].id, leftover: school.rows[0].school_code, loginCode };
}

async function seed(pool) {
  const schoolA = await seedSchool(pool, {
    countryName: "RDC",
    iso: "CD",
    leftover: LEFTOVER_A,
    shortCode: "SY",
    name: "Lycée A",
    classCode: CLASS_A,
  });
  const schoolB = await seedSchool(pool, {
    countryName: "Burundi",
    iso: "BI",
    leftover: LEFTOVER_B,
    shortCode: "SY",
    name: "Lycée B",
    classCode: CLASS_B,
  });
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $3, 'ADM-ENR-A', 'Ada', 'A', 'adm-enr-a@test.local', 'SCHOOL_ADMIN', 'active', FALSE),
       ($2, $4, 'ADM-ENR-B', 'Beno', 'B', 'adm-enr-b@test.local', 'SCHOOL_ADMIN', 'active', FALSE)`,
    [USER_A, USER_B, schoolA.schoolId, schoolB.schoolId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES ($1, $3, 'SCHOOL_ADMIN', 'active'), ($2, $4, 'SCHOOL_ADMIN', 'active')`,
    [USER_A, USER_B, schoolA.schoolId, schoolB.schoolId],
  );
  await grantStudentsCreate(pool);
  return { schoolA, schoolB };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentEnrollmentTenant.http.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  let child = null;

  try {
    await repo.init();
    const { schoolA, schoolB } = await seed(repo.pool);
    assert.equal(schoolA.leftover, LEFTOVER_A);
    assert.ok(isV2SchoolLoginCode(schoolA.loginCode));
    assert.notEqual(schoolA.loginCode, LEFTOVER_A);

    const financeStore = repo.getFinanceStore();
    const leftoverFinance = await financeStore.withTransaction((tx) => tx.getSchoolByCode(LEFTOVER_A));
    assert.equal(leftoverFinance, null, "leftover n'est pas une identité Finance valide");
    const canonicalFinance = await financeStore.withTransaction((tx) => tx.getSchoolByCode(schoolA.loginCode));
    assert.ok(canonicalFinance?.id, "Finance résout le login_code V2");
    assert.equal(String(canonicalFinance.id), String(schoolA.schoolId));

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    await waitForHealth(child, stderrRef);

    const leftoverJwt = mintAccess(tokens, { sub: USER_A, schoolCode: LEFTOVER_A });

    const enrolled = await request(`/classes/${encodeURIComponent(CLASS_A)}/students`, {
      method: "POST",
      token: leftoverJwt,
      body: {
        firstName: "Awa",
        lastName: "Diop",
        gender: "Féminin",
        birthDate: "2012-04-12",
      },
    });
    assert.equal(enrolled.status, 201, `enroll leftover JWT: ${JSON.stringify(enrolled.data)}`);
    const studentCode = String(enrolled.data?.student?.studentCode ?? "");
    assert.ok(studentCode, "studentCode canonique");

    const persisted = await repo.pool.query(
      `SELECT st.school_id AS student_school_id,
              e.school_id AS enrollment_school_id,
              s.login_code,
              s.school_code
         FROM students st
         JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
         JOIN schools s ON s.id = st.school_id
        WHERE st.student_code = $1 OR st.login_code = $1 OR st.identity_code = $1
        LIMIT 1`,
      [studentCode],
    );
    assert.equal(persisted.rowCount, 1, "élève + inscription persistés");
    assert.equal(String(persisted.rows[0].student_school_id), String(schoolA.schoolId));
    assert.equal(String(persisted.rows[0].enrollment_school_id), String(schoolA.schoolId));
    assert.equal(String(persisted.rows[0].login_code).toUpperCase(), schoolA.loginCode);
    assert.equal(String(persisted.rows[0].school_code).toUpperCase(), LEFTOVER_A);

    const financeSync = await repo.enrollStudentInClass(CLASS_A, LEFTOVER_A, {
      firstName: "Finance",
      lastName: "Probe",
      gender: "Masculin",
      birthDate: "2011-06-01",
    });
    assert.ok(financeSync?.student?.studentCode);
    assert.notEqual(financeSync?.financeSync?.error, "TENANT_MISMATCH");
    assert.notEqual(financeSync?.financeSync?.schoolCode, LEFTOVER_A);
    const probeCode = financeSync.student.studentCode;
    const probeSchool = await repo.one(
      `SELECT s.login_code FROM students st
       JOIN schools s ON s.id = st.school_id
       WHERE st.student_code = $1 OR st.identity_code = $1
       LIMIT 1`,
      [probeCode],
    );
    assert.equal(String(probeSchool.login_code).toUpperCase(), schoolA.loginCode);

    const foreign = await request(`/classes/${encodeURIComponent(CLASS_B)}/students`, {
      method: "POST",
      token: leftoverJwt,
      body: {
        firstName: "Other",
        lastName: "Tenant",
        gender: "Féminin",
        birthDate: "2012-01-01",
      },
    });
    assert.ok(foreign.status === 403 || foreign.status === 404, `classe étrangère refusée: ${JSON.stringify(foreign.data)}`);

    console.log("OK studentEnrollmentTenant.http.pg.test.js — leftover JWT, login_code Finance, isolation");
  } finally {
    await stopChild(child);
    if (typeof repo.close === "function") await repo.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
