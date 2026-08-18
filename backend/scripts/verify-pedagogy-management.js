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
    const schoolBId = (
      await pool.query(`SELECT id FROM schools WHERE school_code = 'BI-2026-0002'`)
    ).rows[0].id;
    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'BI-2026-0002-STU-01', 'Jean', 'BI', 'active')`,
      [schoolBId],
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
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'PREFET-CD-2026-0001-01', 'Samuel', 'Prefet', 'prefet-http@test.cd', $2, $2, 'PREFET_ETUDES', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'SECRETAIRE-CD-2026-0001-01', 'Amina', 'Secretaire', 'secretaire-http@test.cd', $2, $2, 'SECRETARY', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       VALUES ($1, 'PARENT-CD-2026-0001-01', 'Parent', 'HTTP', 'parent-http@test.cd', '+243 820 000 001', $2, $2, 'PARENT', 'active')`,
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
      `INSERT INTO terms (academic_year_id, name, status)
       VALUES ($1, 'Trimestre 1', 'open')`,
      [year.rows[0].id],
    );
    const student = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'CD-2026-0001-STU-HTTP-01', 'Awa', 'HTTP', 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [schoolA.rows[0].id, student.rows[0].id, klass.rows[0].id, year.rows[0].id],
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

function schedulePayload(stamp, extra = {}) {
  return {
    className: "6ème A",
    subject: "Mathématiques",
    teacherId: "ENS-0001",
    start: "2026-10-02T08:00:00.000Z",
    end: "2026-10-02T09:00:00.000Z",
    ...extra,
    id: extra.id ?? `SCH-RBAC-${stamp}`,
  };
}

function assertPermissionDenied(result, label) {
  assert.equal(result.status, 403, `${label}: ${JSON.stringify(result.data)}`);
  assert.equal(result.data?.code, "PERMISSION_DENIED", `${label} code ${result.data?.code}`);
}

async function assertCourseScheduleWriteDenied(port, token, scheduleId, label) {
  assertPermissionDenied(
    await request(port, "/course-schedules", {
      method: "POST",
      token,
      body: schedulePayload(Date.now(), { id: `SCH-DENY-${label}` }),
    }),
    `${label} POST`,
  );
  if (scheduleId) {
    assertPermissionDenied(
      await request(port, `/course-schedules/${scheduleId}`, {
        method: "PATCH",
        token,
        body: { start: "2026-10-02T10:00:00.000Z", end: "2026-10-02T11:00:00.000Z" },
      }),
      `${label} PATCH`,
    );
    assertPermissionDenied(
      await request(port, `/course-schedules/${scheduleId}`, { method: "DELETE", token }),
      `${label} DELETE`,
    );
  }
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
    const prefetToken = await login(MEMORY_PORT, "prefet", "1234", "CD-2026-0001");
    const secretaryToken = await login(MEMORY_PORT, "secretaire", "1234", "CD-2026-0001");

    const unauth = await request(MEMORY_PORT, "/courses", { method: "POST", body: {} });
    assert.equal(unauth.status, 401, "POST /courses sans token");

    const coursesRead = await request(MEMORY_PORT, "/courses", { token: adminToken });
    assert.equal(coursesRead.status, 200);
    assert.ok(Array.isArray(coursesRead.data));

    const schedulesRead = await request(MEMORY_PORT, "/course-schedules", { token: adminToken });
    assert.equal(schedulesRead.status, 200);
    assert.ok(Array.isArray(schedulesRead.data));

    const teacherSchedules = await request(MEMORY_PORT, "/course-schedules", { token: teacherToken });
    assert.equal(teacherSchedules.status, 200, JSON.stringify(teacherSchedules.data));
    assert.ok(Array.isArray(teacherSchedules.data));

    assertPermissionDenied(
      await request(MEMORY_PORT, "/course-schedules", { token: parentToken }),
      "parent GET memory",
    );
    assertPermissionDenied(
      await request(MEMORY_PORT, "/course-schedules", { token: secretaryToken }),
      "secretaire GET memory",
    );
    await assertCourseScheduleWriteDenied(MEMORY_PORT, teacherToken, "sch-memory-deny", "enseignant memory");
    await assertCourseScheduleWriteDenied(MEMORY_PORT, parentToken, "sch-memory-deny", "parent memory");
    await assertCourseScheduleWriteDenied(MEMORY_PORT, secretaryToken, "sch-memory-deny", "secretaire memory");

    const prefetRead = await request(MEMORY_PORT, "/course-schedules", { token: prefetToken });
    assert.equal(prefetRead.status, 200, JSON.stringify(prefetRead.data));

    const notesRead = await request(MEMORY_PORT, "/notes", { token: adminToken });
    assert.equal(notesRead.status, 200);

    const evaluationsRead = await request(MEMORY_PORT, "/evaluations", { token: adminToken });
    assert.equal(evaluationsRead.status, 200, JSON.stringify(evaluationsRead.data));
    assert.ok(Array.isArray(evaluationsRead.data));

    const presencesRead = await request(MEMORY_PORT, "/presences", { token: adminToken });
    assert.equal(presencesRead.status, 200);

    const parentCourse = await request(MEMORY_PORT, "/courses", {
      method: "POST",
      token: parentToken,
      body: { className: "6ème A", name: "Mathématiques" },
    });
    assert.notEqual(parentCourse.status, 201, "parent ne crée pas de cours");
    assert.ok(parentCourse.status >= 400, `parent bloqué: ${parentCourse.status}`);

    const teacherNote = await request(MEMORY_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: "EVAL-TEST",
        studentId: "CD-IN-EL-26-001",
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
  const pool = new Pool({ connectionString: isolatedUrl });
  const child = spawnBackend({ port: PG_PORT, databaseUrl: isolatedUrl });
  try {
    await waitForHealth(child, PG_PORT);
    const adminToken = await login(PG_PORT, "admin", "1234", "CD-2026-0001");
    const teacherToken = await login(PG_PORT, "ENS-0001", "1234", "CD-2026-0001");
    const prefetToken = await login(PG_PORT, "prefet", "1234", "CD-2026-0001");
    const secretaryToken = await login(PG_PORT, "secretaire", "1234", "CD-2026-0001");
    const parentToken = await login(PG_PORT, "+243 820 000 001", "1234", "CD-2026-0001");
    const stamp = Date.now();
    const schoolBId = (
      await pool.query(`SELECT id FROM schools WHERE school_code = 'BI-2026-0002'`)
    ).rows[0].id;

    const schoolsBefore = await pool.query(`SELECT school_code FROM schools ORDER BY school_code`);
    assert.equal(schoolsBefore.rowCount, 2);
    const subjectsBefore = await pool.query(
      `SELECT count(*)::int AS count FROM subjects s
       JOIN schools sc ON sc.id = s.school_id
       WHERE sc.school_code = 'CD-2026-0001'`,
    );
    const subjectCountBefore = subjectsBefore.rows[0].count;

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

    const prefetSchedule = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: prefetToken,
      body: {
        id: `SCH-HTTP-PREFET-${stamp}`,
        className: "6ème A",
        subject: "Mathématiques",
        teacherId: "ENS-0001",
        start: "2026-10-03T08:00:00.000Z",
        end: "2026-10-03T09:00:00.000Z",
      },
    });
    assert.equal(prefetSchedule.status, 201, JSON.stringify(prefetSchedule.data));

    const teacherGet = await request(PG_PORT, "/course-schedules", { token: teacherToken });
    assert.equal(teacherGet.status, 200, JSON.stringify(teacherGet.data));
    assert.ok(Array.isArray(teacherGet.data), "GET enseignant = liste (scope métier inchangé dans ce lot)");

    assertPermissionDenied(
      await request(PG_PORT, "/course-schedules", { token: parentToken }),
      "parent GET",
    );
    assertPermissionDenied(
      await request(PG_PORT, "/course-schedules", { token: secretaryToken }),
      "secretaire GET",
    );
    await assertCourseScheduleWriteDenied(PG_PORT, teacherToken, validSchedule.data.id, "enseignant");
    await assertCourseScheduleWriteDenied(PG_PORT, parentToken, validSchedule.data.id, "parent");
    await assertCourseScheduleWriteDenied(PG_PORT, secretaryToken, validSchedule.data.id, "secretaire");

    const slotStillPresent = await pool.query(
      `SELECT count(*)::int AS count FROM course_schedule_slots WHERE legacy_json_id = $1`,
      [`SCH-HTTP-${stamp}`],
    );
    assert.equal(slotStillPresent.rows[0].count, 1, "DELETE enseignant/parent refusé : créneau conservé");

    const coursesList = await request(PG_PORT, "/courses", { token: adminToken });
    assert.equal(coursesList.status, 200, JSON.stringify(coursesList.data));
    assert.ok(Array.isArray(coursesList.data), "projection courses en lecture");
    assert.ok(
      (coursesList.data ?? []).some((row) => row.className === "6ème A" && row.name === "Mathématiques"),
      "cours canonique visible via GET /courses",
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

    const teacherUnknownSubject = await request(PG_PORT, "/courses", {
      method: "POST",
      token: teacherToken,
      body: { className: "6ème A", name: `Matière-${stamp}` },
    });
    assert.equal(teacherUnknownSubject.status, 404, JSON.stringify(teacherUnknownSubject.data));
    assert.equal(teacherUnknownSubject.data?.code, PEDAGOGY_ERROR.COURSE_NOT_FOUND);

    const forgedEvaluation = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: adminToken,
      body: {
        id: `EVAL-FORGE-${stamp}`,
        schoolCode: "BI-2026-0002",
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Contrôle tenant",
        teacherId: "ENS-0001",
        evaluationType: "Devoir",
        scale: 20,
      },
    });
    assert.equal(forgedEvaluation.status, 201, JSON.stringify(forgedEvaluation.data));
    const evalTenant = await pool.query(
      `SELECT s.school_code
       FROM evaluations e
       JOIN schools s ON s.id = e.school_id
       WHERE e.legacy_json_id = $1`,
      [`EVAL-FORGE-${stamp}`],
    );
    assert.equal(evalTenant.rowCount, 1);
    assert.equal(evalTenant.rows[0].school_code, "CD-2026-0001", "évaluation scellée au tenant principal");

    const evalInBi = await pool.query(
      `SELECT count(*)::int AS count
       FROM evaluations e
       JOIN schools s ON s.id = e.school_id
       WHERE s.school_code = 'BI-2026-0002'`,
    );
    assert.equal(evalInBi.rows[0].count, 0, "aucune évaluation dans l'établissement BI");

    const biYear = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolBId],
    );
    const biClass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-BI-HTTP', '6ème BI', 'active') RETURNING id`,
      [schoolBId, biYear.rows[0].id],
    );
    const biSubject = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-BI-HTTP', 'Mathématiques', 1, 'active') RETURNING id`,
      [schoolBId],
    );
    const biTerm = await pool.query(
      `INSERT INTO terms (academic_year_id, name, status)
       VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
      [biYear.rows[0].id],
    );
    const biEvaluation = await pool.query(
      `INSERT INTO evaluations (
         school_id, class_id, subject_id, term_id, title, evaluation_type,
         evaluation_date, max_score, coefficient, status, active, legacy_json_id
       ) VALUES ($1,$2,$3,$4,'Éval BI HTTP','test','2026-01-01',20,1,'draft',true,$5)
       RETURNING id, legacy_json_id, title`,
      [schoolBId, biClass.rows[0].id, biSubject.rows[0].id, biTerm.rows[0].id, `EVAL-BI-HTTP-${stamp}`],
    );

    const patchForeignUuid = await request(PG_PORT, `/evaluations/${biEvaluation.rows[0].id}`, {
      method: "PATCH",
      token: adminToken,
      body: { title: "Compromis UUID" },
    });
    assert.equal(patchForeignUuid.status, 404, JSON.stringify(patchForeignUuid.data));

    const postForeignLegacy = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: adminToken,
      body: {
        id: biEvaluation.rows[0].legacy_json_id,
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Compromis legacy",
        teacherId: "ENS-0001",
        scale: 20,
      },
    });
    assert.equal(postForeignLegacy.status, 404, JSON.stringify(postForeignLegacy.data));

    const biEvalUnchanged = await pool.query(`SELECT title FROM evaluations WHERE id = $1`, [
      biEvaluation.rows[0].id,
    ]);
    assert.equal(biEvalUnchanged.rows[0].title, "Éval BI HTTP");

    const sekeCreate = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Interrogation 1",
        teacherId: "ENS-0001",
        evaluationType: "Devoir",
        scale: 20,
        coefficient: 1,
      },
    });
    assert.equal(sekeCreate.status, 201, JSON.stringify(sekeCreate.data));
    assert.equal(sekeCreate.data?.title, "Interrogation 1");
    assert.equal(sekeCreate.data?.period, "Trimestre 1", "period = term_name, pas term_id");
    assert.notEqual(String(sekeCreate.data?.period ?? ""), String(sekeCreate.data?.termId ?? ""));

    const pgCreated = await pool.query(
      `SELECT e.title, e.status, e.active, tm.name AS term_name, e.term_id::text AS term_id,
              s.school_code, sub.name AS subject_name, c.name AS class_name
       FROM evaluations e
       JOIN schools s ON s.id = e.school_id
       JOIN terms tm ON tm.id = e.term_id
       JOIN subjects sub ON sub.id = e.subject_id
       JOIN classes c ON c.id = e.class_id
       WHERE e.title = 'Interrogation 1' AND s.school_code = 'CD-2026-0001'`,
    );
    assert.equal(pgCreated.rowCount, 1, "évaluation persistée PostgreSQL");
    assert.equal(pgCreated.rows[0].term_name, "Trimestre 1");
    assert.equal(pgCreated.rows[0].subject_name, "Mathématiques");
    assert.equal(pgCreated.rows[0].class_name, "6ème A");

    const teacherRefresh = await request(PG_PORT, "/evaluations", { token: teacherToken });
    assert.equal(teacherRefresh.status, 200, JSON.stringify(teacherRefresh.data));
    const sekeRow = (teacherRefresh.data ?? []).find((row) => row.title === "Interrogation 1");
    assert.ok(sekeRow, `GET /evaluations enseignant: ${JSON.stringify(teacherRefresh.data)}`);
    assert.equal(sekeRow.period, "Trimestre 1");
    assert.equal(sekeRow.subject, "Mathématiques");
    assert.equal(sekeRow.course, "Mathématiques");
    assert.ok(sekeRow.classId, "classId canonique");
    assert.ok(sekeRow.subjectId, "subjectId technique V2");
    assert.notEqual(String(sekeRow.period), String(sekeRow.termId ?? ""));
    assert.equal(sekeRow.status, "Brouillon");

    const adverbs = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "LES ADVERBES",
        teacherId: "ENS-0001",
        evaluationType: "Devoir",
        scale: 20,
        coefficient: 1,
      },
    });
    assert.equal(adverbs.status, 201, JSON.stringify(adverbs.data));
    assert.equal(adverbs.data?.status, "Brouillon");

    const teacherSelfValidate = await request(PG_PORT, `/evaluations/${encodeURIComponent(adverbs.data.id)}`, {
      method: "PATCH",
      token: teacherToken,
      body: { status: "Validée" },
    });
    assert.equal(teacherSelfValidate.status, 403, JSON.stringify(teacherSelfValidate.data));
    assert.equal(teacherSelfValidate.data?.code, PEDAGOGY_ERROR.EVALUATION_VALIDATION_FORBIDDEN);

    const noteBeforeValidation = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: adverbs.data.id,
        studentId: "CD-2026-0001-STU-HTTP-01",
        value: 14,
        scale: 20,
      },
    });
    assert.equal(noteBeforeValidation.status, 409, JSON.stringify(noteBeforeValidation.data));
    assert.equal(noteBeforeValidation.data?.code, PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED);

    const gradesBefore = await pool.query(
      `SELECT count(*)::int AS count
       FROM grades g
       JOIN evaluations e ON e.id = g.evaluation_id
       WHERE e.title = 'LES ADVERBES'`,
    );
    assert.equal(gradesBefore.rows[0].count, 0, "aucune note PostgreSQL avant validation");

    const prefetValidate = await request(PG_PORT, `/evaluations/${encodeURIComponent(adverbs.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    assert.equal(prefetValidate.status, 200, JSON.stringify(prefetValidate.data));
    assert.equal(prefetValidate.data?.status, "Validée");

    const pgValidated = await pool.query(
      `SELECT e.status, e.active
       FROM evaluations e
       JOIN schools s ON s.id = e.school_id
       WHERE e.title = 'LES ADVERBES' AND s.school_code = 'CD-2026-0001'`,
    );
    assert.equal(pgValidated.rows[0].status, "locked", "Validée UI = locked PG");

    const teacherAfterValidate = await request(PG_PORT, "/evaluations", { token: teacherToken });
    const adverbsRow = (teacherAfterValidate.data ?? []).find((row) => row.title === "LES ADVERBES");
    assert.ok(adverbsRow, "enseignant relit LES ADVERBES après validation");
    assert.equal(adverbsRow.status, "Validée");

    const noteAfterValidation = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: adverbs.data.id,
        studentId: "CD-2026-0001-STU-HTTP-01",
        value: 14,
        scale: 20,
      },
    });
    assert.ok([200, 201].includes(noteAfterValidation.status), JSON.stringify(noteAfterValidation.data));
    assert.equal(Number(noteAfterValidation.data?.value ?? noteAfterValidation.data?.score), 14);

    const pgGrade = await pool.query(
      `SELECT g.score
       FROM grades g
       JOIN evaluations e ON e.id = g.evaluation_id
       JOIN students st ON st.id = g.student_id
       WHERE e.title = 'LES ADVERBES' AND st.student_code = 'CD-2026-0001-STU-HTTP-01'`,
    );
    assert.equal(pgGrade.rowCount, 1, "note persistée PostgreSQL");
    assert.equal(Number(pgGrade.rows[0].score), 14);

    const notesRefresh = await request(PG_PORT, "/notes", { token: teacherToken });
    assert.equal(notesRefresh.status, 200);
    const persistedNote = (notesRefresh.data ?? []).find(
      (row) => String(row.evaluationId ?? "") === String(adverbs.data.id) || Number(row.value ?? row.score) === 14,
    );
    assert.ok(persistedNote, `GET /notes relit 14/20: ${JSON.stringify(notesRefresh.data)}`);

    const historyEval = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: adminToken,
      body: {
        className: "6ème A",
        subject: "Histoire",
        period: "Trimestre 1",
        title: "Devoir Histoire hors scope",
        evaluationType: "Devoir",
        scale: 20,
      },
    });
    assert.equal(historyEval.status, 201, JSON.stringify(historyEval.data));

    const yearRow = await pool.query(
      `SELECT ay.id
       FROM academic_years ay
       JOIN schools s ON s.id = ay.school_id
       WHERE s.school_code = 'CD-2026-0001' AND ay.name = '2025-2026'`,
    );
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES (
         (SELECT id FROM schools WHERE school_code = 'CD-2026-0001'),
         $1, 'CLS-6B', '6ème B', 'active'
       )`,
      [yearRow.rows[0].id],
    );
    const classBStudent = await pool.query(
      `INSERT INTO students (school_id, first_name, last_name, status)
       VALUES (
         (SELECT id FROM schools WHERE school_code = 'CD-2026-0001'),
         'Hors', 'Classe', 'active'
       ) RETURNING id, student_code`,
    );
    const classBStudentCode = String(classBStudent.rows[0].student_code);
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES (
         (SELECT id FROM schools WHERE school_code = 'CD-2026-0001'),
         $1,
         (SELECT id FROM classes WHERE class_code = 'CLS-6B' AND school_id = (SELECT id FROM schools WHERE school_code = 'CD-2026-0001')),
         $2,
         'active'
       )`,
      [classBStudent.rows[0].id, yearRow.rows[0].id],
    );
    const otherClassEval = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: adminToken,
      body: {
        className: "6ème B",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Interro 6ème B",
        evaluationType: "Devoir",
        scale: 20,
      },
    });
    assert.equal(otherClassEval.status, 201, JSON.stringify(otherClassEval.data));

    const teacherScoped = await request(PG_PORT, "/evaluations", { token: teacherToken });
    const teacherTitles = (teacherScoped.data ?? []).map((row) => row.title);
    assert.equal(teacherTitles.includes("Interrogation 1"), true);
    assert.equal(teacherTitles.includes("Devoir Histoire hors scope"), false, "cours non affecté invisible");
    assert.equal(teacherTitles.includes("Interro 6ème B"), false, "autre classe invisible");
    assert.equal(teacherTitles.includes("Éval BI HTTP"), false, "autre établissement invisible");

    const adminScoped = await request(PG_PORT, "/evaluations", { token: adminToken });
    const adminTitles = (adminScoped.data ?? []).map((row) => row.title);
    assert.equal(adminTitles.includes("Interrogation 1"), true);
    assert.equal(adminTitles.includes("Devoir Histoire hors scope"), true);
    assert.equal(adminTitles.includes("Éval BI HTTP"), false, "admin CD ne lit pas BI");

    const otherPasswordHash = hashSecret("1234");
    const otherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES (
         (SELECT id FROM schools WHERE school_code = 'CD-2026-0001'),
         'ENS-0002', 'Autre', 'Prof', 'ens2-http@test.cd', $1, $1, 'TEACHER', 'active'
       ) RETURNING id`,
      [otherPasswordHash],
    );
    await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ((SELECT id FROM schools WHERE school_code = 'CD-2026-0001'), $1, 'ENS-0002', 'active')`,
      [otherUser.rows[0].id],
    );
    const otherTeacherToken = await login(PG_PORT, "ENS-0002", "1234", "CD-2026-0001");
    const otherTeacherList = await request(PG_PORT, "/evaluations", { token: otherTeacherToken });
    assert.equal(otherTeacherList.status, 200, JSON.stringify(otherTeacherList.data));
    assert.equal((otherTeacherList.data ?? []).length, 0, "enseignant non affecté : liste vide");

    const otherTeacherNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: otherTeacherToken,
      body: {
        evaluationId: adverbs.data.id,
        studentId: "CD-2026-0001-STU-HTTP-01",
        value: 11,
        scale: 20,
      },
    });
    assert.equal(otherTeacherNote.status, 403, JSON.stringify(otherTeacherNote.data));

    const historyValidated = await request(PG_PORT, `/evaluations/${encodeURIComponent(historyEval.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    assert.equal(historyValidated.status, 200, JSON.stringify(historyValidated.data));
    const otherCourseNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: historyEval.data.id,
        studentId: "CD-2026-0001-STU-HTTP-01",
        value: 12,
        scale: 20,
      },
    });
    assert.equal(otherCourseNote.status, 403, JSON.stringify(otherCourseNote.data));

    const otherClassValidated = await request(PG_PORT, `/evaluations/${encodeURIComponent(otherClassEval.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    assert.equal(otherClassValidated.status, 200, JSON.stringify(otherClassValidated.data));
    const otherClassNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: otherClassEval.data.id,
        studentId: classBStudentCode,
        value: 12,
        scale: 20,
      },
    });
    assert.equal(otherClassNote.status, 403, JSON.stringify(otherClassNote.data));

    const otherSchoolNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: biEvaluation.rows[0].legacy_json_id,
        studentId: "CD-2026-0001-STU-HTTP-01",
        value: 12,
        scale: 20,
      },
    });
    assert.ok([403, 404].includes(otherSchoolNote.status), JSON.stringify(otherSchoolNote.data));

    const unenrolledNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: adverbs.data.id,
        studentId: classBStudentCode,
        value: 12,
        scale: 20,
      },
    });
    assert.ok([403, 409].includes(unenrolledNote.status), JSON.stringify(unenrolledNote.data));
    assert.ok(
      unenrolledNote.data?.code === PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED || unenrolledNote.status === 403,
      JSON.stringify(unenrolledNote.data),
    );

    const cancelledEval = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "EVAL ANNULEE SAISIE",
        teacherId: "ENS-0001",
        evaluationType: "Devoir",
        scale: 20,
      },
    });
    assert.equal(cancelledEval.status, 201, JSON.stringify(cancelledEval.data));
    const cancelledValidated = await request(PG_PORT, `/evaluations/${encodeURIComponent(cancelledEval.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    assert.equal(cancelledValidated.status, 200, JSON.stringify(cancelledValidated.data));
    const cancelledArchived = await request(PG_PORT, `/evaluations/${encodeURIComponent(cancelledEval.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Annulée" },
    });
    assert.equal(cancelledArchived.status, 200, JSON.stringify(cancelledArchived.data));
    const cancelledNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: cancelledEval.data.id,
        studentId: "CD-2026-0001-STU-HTTP-01",
        value: 12,
        scale: 20,
      },
    });
    assert.equal(cancelledNote.status, 409, JSON.stringify(cancelledNote.data));
    assert.equal(cancelledNote.data?.code, PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED);

    const publishedEval = await request(PG_PORT, "/evaluations", {
      method: "POST",
      token: teacherToken,
      body: {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "EVAL PUBLIEE SAISIE",
        teacherId: "ENS-0001",
        evaluationType: "Devoir",
        scale: 20,
      },
    });
    assert.equal(publishedEval.status, 201, JSON.stringify(publishedEval.data));
    const publishedValidated = await request(PG_PORT, `/evaluations/${encodeURIComponent(publishedEval.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    assert.equal(publishedValidated.status, 200, JSON.stringify(publishedValidated.data));
    const published = await request(PG_PORT, `/evaluations/${encodeURIComponent(publishedEval.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Publiée" },
    });
    assert.equal(published.status, 200, JSON.stringify(published.data));
    const publishedNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: teacherToken,
      body: {
        evaluationId: publishedEval.data.id,
        studentId: "CD-2026-0001-STU-HTTP-01",
        value: 12,
        scale: 20,
      },
    });
    assert.equal(publishedNote.status, 409, JSON.stringify(publishedNote.data));
    assert.equal(publishedNote.data?.code, PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED);

    const patched = await request(PG_PORT, `/evaluations/${encodeURIComponent(sekeCreate.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { title: "Interrogation 1 bis" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    const afterPatch = await request(PG_PORT, "/evaluations", { token: teacherToken });
    assert.equal(
      (afterPatch.data ?? []).some((row) => row.title === "Interrogation 1 bis"),
      true,
      "PATCH relue via GET",
    );

    const deactivated = await request(PG_PORT, `/evaluations/${encodeURIComponent(sekeCreate.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { active: false },
    });
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.data));
    const afterDeactivate = await request(PG_PORT, "/evaluations", { token: adminToken });
    const deactivatedRow = (afterDeactivate.data ?? []).find((row) => row.id === sekeCreate.data.id);
    assert.ok(deactivatedRow, "désactivation relue");
    assert.equal(deactivatedRow.active, false);

    const pgAfterDeactivate = await pool.query(
      `SELECT active FROM evaluations WHERE legacy_json_id = $1 OR id::text = $1`,
      [sekeCreate.data.id],
    );
    assert.equal(pgAfterDeactivate.rows[0].active, false);

    const forgeValidate = await request(PG_PORT, `/evaluations/${encodeURIComponent(forgedEvaluation.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    assert.equal(forgeValidate.status, 200, JSON.stringify(forgeValidate.data));

    const forgedNote = await request(PG_PORT, "/notes", {
      method: "POST",
      token: adminToken,
      body: {
        schoolCode: "BI-2026-0002",
        evaluationId: `EVAL-FORGE-${stamp}`,
        studentId: "CD-2026-0001-STU-HTTP-01",
        teacherId: "ENS-0001",
        value: 12,
        scale: 20,
      },
    });
    assert.equal(forgedNote.status, 201, JSON.stringify(forgedNote.data));
    const noteTenant = await pool.query(
      `SELECT s.school_code
       FROM grades g
       JOIN schools s ON s.id = g.school_id
       JOIN evaluations e ON e.id = g.evaluation_id
       WHERE e.legacy_json_id = $1`,
      [`EVAL-FORGE-${stamp}`],
    );
    assert.equal(noteTenant.rowCount, 1);
    assert.equal(noteTenant.rows[0].school_code, "CD-2026-0001");

    const forgedPresence = await request(PG_PORT, "/presences", {
      method: "POST",
      token: adminToken,
      body: {
        items: [
          {
            schoolCode: "BI-2026-0002",
            studentId: "CD-2026-0001-STU-HTTP-01",
            className: "6ème A",
            date: "2026-09-10",
            status: "present",
            teacherId: "ENS-0001",
          },
        ],
      },
    });
    assert.equal(forgedPresence.status, 201, JSON.stringify(forgedPresence.data));
    const presenceTenant = await pool.query(
      `SELECT s.school_code
       FROM attendance a
       JOIN schools s ON s.id = a.school_id
       JOIN students st ON st.id = a.student_id
       WHERE st.student_code = 'CD-2026-0001-STU-HTTP-01'`,
    );
    assert.equal(presenceTenant.rowCount, 1);
    assert.equal(presenceTenant.rows[0].school_code, "CD-2026-0001");

    const biStudentPresence = await request(PG_PORT, "/presences", {
      method: "POST",
      token: adminToken,
      body: {
        items: [
          {
            studentId: "BI-2026-0002-STU-01",
            className: "6ème A",
            date: "2026-09-11",
            status: "present",
            teacherId: "ENS-0001",
          },
        ],
      },
    });
    assert.equal(biStudentPresence.status, 404, JSON.stringify(biStudentPresence.data));
    const biPresenceCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM attendance a
       JOIN schools s ON s.id = a.school_id
       WHERE s.school_code = 'BI-2026-0002'`,
    );
    assert.equal(biPresenceCount.rows[0].count, 0, "zéro présence BI via admin CD");
    const biAuditCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM audit_logs al
       JOIN schools s ON s.id = al.school_id
       WHERE s.school_code = 'BI-2026-0002'`,
    );
    assert.equal(biAuditCount.rows[0].count, 0, "zéro audit BI");

    const schedulePatchForbidden = await request(PG_PORT, `/course-schedules/${validSchedule.data.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { subject: "Histoire" },
    });
    assert.equal(schedulePatchForbidden.status, 403, JSON.stringify(schedulePatchForbidden.data));
    assert.equal(
      schedulePatchForbidden.data?.code,
      PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
      "PATCH créneau sans teacherId revalide l'affectation",
    );
    const slotAfterFailedPatch = await pool.query(
      `SELECT class_name, subject_name, class_id
       FROM course_schedule_slots
       WHERE legacy_json_id = $1`,
      [`SCH-HTTP-${stamp}`],
    );
    assert.equal(slotAfterFailedPatch.rows[0].class_name, "6ème A");
    assert.equal(slotAfterFailedPatch.rows[0].subject_name, "Mathématiques");
    assert.ok(slotAfterFailedPatch.rows[0].class_id, "class_id canonique conservé");

    const subjectsAfter = await pool.query(
      `SELECT count(*)::int AS count FROM subjects s
       JOIN schools sc ON sc.id = s.school_id
       WHERE sc.school_code = 'CD-2026-0001'`,
    );
    assert.equal(subjectsAfter.rows[0].count, subjectCountBefore, "aucune matière inventée");

    console.log("OK http-pg: validation références + affectation + projection");
  } finally {
    child.kill("SIGTERM");
    await pool.end().catch(() => {});
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
