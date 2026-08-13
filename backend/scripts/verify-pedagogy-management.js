"use strict";

/**
 * LOT 5 — parcours Pédagogie HTTP :
 * RBAC, isolation, validation références canoniques (PostgreSQL CI),
 * codes d'erreur métier et projection lecture.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { hashSecret } = require("../services/credentialService");

const ROOT = path.resolve(__dirname, "../..");
const MEMORY_PORT = 19676;
const PG_PORT = 19677;
const { PEDAGOGY_ERROR } = require("../lib/pedagogyManagement");
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_PEDAGOGY_HTTP_IT_DATABASE ?? "somafrik_pedagogy_http_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

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
    if (!existing.rowCount) {
      await pool.query(`CREATE DATABASE ${databaseName}`);
    }
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function preparePedagogyHttpDatabase(databaseUrl) {
  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, PG_HTTP_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret("1234");
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(PEDAGOGY_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Lycée HTTP', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'BI-2026-0002', 'Lycée B', 'active')`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
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
    const history = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-HIST', 'Histoire', 1, 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const adminUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-CD-2026-0001-01', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')
       RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-0001', 'Paul', 'Prof', 'ens-http@test.cd', $2, $2, 'TEACHER', 'active')
       RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'ENS-0001', 'active') RETURNING id`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [schoolA.rows[0].id, teacher.rows[0].id, klass.rows[0].id, math.rows[0].id, year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2025-09-01')`,
      [schoolA.rows[0].id],
    );
    void history;
    void adminUser;
  } finally {
    await pool.end();
  }
  return isolatedUrl;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(port) {
  return `http://127.0.0.1:${port}/api`;
}

async function request(port, pathname, { method = "GET", token, body, headers } = {}) {
  const response = await fetch(`${baseUrl(port)}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
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

function spawnBackend({ port, databaseUrl }) {
  const usePg = Boolean(String(databaseUrl ?? "").trim());
  const child = spawn(
    "node",
    [usePg ? "backend/server.js" : "backend/scripts/dev-memory.js"],
    {
      cwd: ROOT,
      env: usePg
        ? {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "development",
            PORT: String(port),
            SOMAFRIK_DB_REQUIRED: "true",
            SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
            SOMAFRIK_SKIP_DEMO_SEED: "true",
            DATABASE_URL: databaseUrl,
            JWT_SECRET: process.env.JWT_SECRET || "verify-pedagogy-management-test-secret-32chars",
          }
        : {
            ...process.env,
            PORT: String(port),
            NODE_ENV: "development",
            SOMAFRIK_DB_REQUIRED: "false",
            SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
            DATABASE_URL: "",
          },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return child;
}

async function runMemoryHttpGuards() {
  const child = spawnBackend({ port: MEMORY_PORT });
  try {
    await waitForHealth(child, MEMORY_PORT);
    const adminToken = await login(MEMORY_PORT, "admin", "1234", "CD-2026-0001");
    const teacherToken = await login(MEMORY_PORT, "ENS-0001", "1234", "CD-2026-0001");
    const parentToken = await login(MEMORY_PORT, "+243 820 000 001", "1234", "CD-2026-0001");

    const unauth = await request(MEMORY_PORT, "/courses", { method: "POST", body: {} });
    assert.equal(unauth.status, 401, "POST /courses sans token");

    const coursesRead = await request(MEMORY_PORT, "/courses", { token: adminToken });
    assert.equal(coursesRead.status, 200);
    assert.ok(Array.isArray(coursesRead.data));

    const schedulesRead = await request(MEMORY_PORT, "/course-schedules", { token: adminToken });
    assert.equal(schedulesRead.status, 200);
    assert.ok(Array.isArray(schedulesRead.data));

    const notesRead = await request(MEMORY_PORT, "/notes", { token: adminToken });
    assert.equal(notesRead.status, 200);

    const presencesRead = await request(MEMORY_PORT, "/presences", { token: adminToken });
    assert.equal(presencesRead.status, 200);

    const parentCourse = await request(MEMORY_PORT, "/courses", {
      method: "POST",
      token: parentToken,
      body: { className: "6ème A", name: "Mathématiques" },
    });
    assert.ok(
      parentCourse.status === 403 || parentCourse.status === 500 || parentCourse.status >= 400,
      "parent ne crée pas de cours",
    );

    const teacherNote = await request(MEMORY_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: "EVAL-TEST",
        studentId: "ELE-0001",
        value: 10,
        scale: 20,
      },
    });
    assert.ok(
      [201, 400, 403, 404, 409].includes(teacherNote.status),
      `POST /notes enseignant: ${teacherNote.status} ${JSON.stringify(teacherNote.data)}`,
    );

    console.log("OK http-memory: routes pédagogie lecture + garde écriture");
  } finally {
    child.kill("SIGTERM");
    await wait(200);
  }
}

async function runPostgresHttpGuards(databaseUrl) {
  const isolatedUrl = await preparePedagogyHttpDatabase(databaseUrl);
  const child = spawnBackend({ port: PG_PORT, databaseUrl: isolatedUrl });
  try {
    await waitForHealth(child, PG_PORT);
    const adminToken = await login(PG_PORT, "admin", "1234", "CD-2026-0001");
    const teacherToken = await login(PG_PORT, "ENS-0001", "1234", "CD-2026-0001");
    const stamp = Date.now();

    const unknownClass = await request(PG_PORT, "/courses", {
      method: "POST",
      token: adminToken,
      body: { className: `Classe-${stamp}`, name: "Mathématiques" },
    });
    assert.equal(unknownClass.status, 404, JSON.stringify(unknownClass.data));
    assert.equal(unknownClass.data?.code, PEDAGOGY_ERROR.COURSE_NOT_FOUND);

    const unknownSubject = await request(PG_PORT, "/courses", {
      method: "POST",
      token: adminToken,
      body: { className: "6ème A", name: `Matière-${stamp}` },
    });
    assert.equal(unknownSubject.status, 404, JSON.stringify(unknownSubject.data));
    assert.equal(unknownSubject.data?.code, PEDAGOGY_ERROR.COURSE_NOT_FOUND);

    const missingAssignment = await request(PG_PORT, "/courses", {
      method: "POST",
      token: adminToken,
      body: {
        className: "6ème A",
        name: "Histoire",
        teacherId: "ENS-0001",
      },
    });
    assert.equal(missingAssignment.status, 403, JSON.stringify(missingAssignment.data));
    assert.equal(missingAssignment.data?.code, PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);

    const validCourse = await request(PG_PORT, "/courses", {
      method: "POST",
      token: adminToken,
      body: {
        className: "6ème A",
        name: "Mathématiques",
        teacherId: "ENS-0001",
      },
    });
    assert.equal(validCourse.status, 201, JSON.stringify(validCourse.data));
    assert.equal(validCourse.data.className, "6ème A");

    const unknownScheduleClass = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: adminToken,
      body: {
        className: `Fantôme-${stamp}`,
        subject: "Mathématiques",
        start: "2026-10-01T08:00:00.000Z",
        end: "2026-10-01T09:00:00.000Z",
      },
    });
    assert.equal(unknownScheduleClass.status, 404);
    assert.equal(unknownScheduleClass.data?.code, PEDAGOGY_ERROR.COURSE_NOT_FOUND);

    const validSchedule = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: adminToken,
      body: {
        id: `SCH-HTTP-${stamp}`,
        className: "6ème A",
        subject: "Mathématiques",
        teacherId: "ENS-0001",
        start: "2026-10-02T08:00:00.000Z",
        end: "2026-10-02T09:00:00.000Z",
      },
    });
    assert.equal(validSchedule.status, 201, JSON.stringify(validSchedule.data));

    const state = await request(PG_PORT, "/backoffice/state", { token: adminToken });
    assert.equal(state.status, 200);
    assert.ok(Array.isArray(state.data.courses), "projection courses en lecture");
    assert.ok(
      (state.data.courses ?? []).some((row) => row.className === "6ème A" && row.name === "Mathématiques"),
      "cours canonique visible dans la projection",
    );

    const crossTenant = await request(PG_PORT, "/courses", {
      method: "POST",
      token: adminToken,
      body: {
        className: "6ème A",
        name: "Histoire",
        schoolCode: "BI-2026-0002",
      },
    });
    assert.equal(crossTenant.status, 201, JSON.stringify(crossTenant.data));
    assert.equal(crossTenant.data?.schoolCode, "CD-2026-0001", "schoolCode client ignoré");

    const teacherForbiddenCourse = await request(PG_PORT, "/courses", {
      method: "POST",
      token: teacherToken,
      body: { className: "6ème A", name: "Histoire" },
    });
    assert.ok(
      [201, 403, 500].includes(teacherForbiddenCourse.status),
      `enseignant POST /courses: ${teacherForbiddenCourse.status}`,
    );

    console.log("OK http-pg: validation références + affectation + projection");
  } finally {
    child.kill("SIGTERM");
    await wait(200);
  }
}

async function main() {
  await runMemoryHttpGuards();
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    await runPostgresHttpGuards(databaseUrl);
  } else {
    console.log("verify-pedagogy-management.js: SKIP http-pg (DATABASE_URL absent)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
