"use strict";

/**
 * Planning V2 hebdomadaire — HTTP + RBAC + concurrence + gel UI.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { hashSecret } = require("../services/credentialService");
const { PEDAGOGY_ERROR } = require("../lib/pedagogyManagement");

const ROOT = path.resolve(__dirname, "../..");
const MEMORY_PORT = 19776;
const PG_PORT = 19777;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_PLANNING_WEEKLY_HTTP_IT_DATABASE ?? "somafrik_planning_weekly_http_it")
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
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function spawnBackend({ port, databaseUrl }) {
  const usePg = Boolean(String(databaseUrl ?? "").trim());
  return spawn("node", [usePg ? "backend/server.js" : "backend/scripts/dev-memory.js"], {
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
          JWT_SECRET: process.env.JWT_SECRET || "verify-planning-v2-weekly-test-secret-32ch",
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
  });
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

async function loginReady(port, identifier, password, schoolCode) {
  let token = await login(port, identifier, password, schoolCode);
  const changed = await request(port, "/auth/change-password", {
    method: "POST",
    token,
    body: { newPassword: "Planning#2026Aa" },
  });
  if ([200, 201].includes(changed.status)) {
    token = changed.data?.accessToken || (await login(port, identifier, "Planning#2026Aa", schoolCode));
  }
  return token;
}

function assertDenied(result, label) {
  assert.equal(result.status, 403, `${label}: ${JSON.stringify(result.data)}`);
}

async function prepareDatabase(databaseUrl) {
  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, PG_HTTP_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret("1234");
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
       VALUES ($1, 'CD-2026-0001', 'Lycée IN', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
      [country.rows[0].id],
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'BI-2026-0002', 'Lycée B', 'active')`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const classA = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-2A', '2ème A', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const classB = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-2B', '2ème B', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const math = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-CD-2026-0001-01', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
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
       VALUES ($1, 'ENS-0001', 'Seke', 'Kilombo', 'seke-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'ENS-0001', 'active') RETURNING id`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active'), ($1, $2, $6, $4, $5, 'active')`,
      [schoolA.rows[0].id, teacher.rows[0].id, classA.rows[0].id, math.rows[0].id, year.rows[0].id, classB.rows[0].id],
    );
    await pool.query(
      `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`,
      [year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2026-09-01')`,
      [schoolA.rows[0].id],
    );
  } finally {
    await pool.end();
  }
  return isolatedUrl;
}

function assertPlanningWebUiEnabled() {
  const constants = fs.readFileSync(path.join(ROOT, "web/src/lib/constants.ts"), "utf8");
  assert.match(constants, /export const PLANNING_WEB_UI_ENABLED = true/);
  const permissions = fs.readFileSync(path.join(ROOT, "web/src/lib/permissions.ts"), "utf8");
  assert.match(permissions, /viewName === "planning" && !PLANNING_WEB_UI_ENABLED/);
  const sync = fs.readFileSync(path.join(ROOT, "web/src/lib/pedagogyPlanningSync.ts"), "utf8");
  assert.match(sync, /toWeeklyScheduleWritePayload/);
  assert.doesNotMatch(sync, /className: slot\.className/);
}

async function runMemoryRbac() {
  const child = spawnBackend({ port: MEMORY_PORT });
  try {
    await waitForHealth(child, MEMORY_PORT);
    const adminToken = await login(MEMORY_PORT, "admin", "1234", "CD-2026-0001");
    const teacherToken = await login(MEMORY_PORT, "ENS-0001", "1234", "CD-2026-0001");
    const parentToken = await login(MEMORY_PORT, "+243 820 000 001", "1234", "CD-2026-0001");
    const secretaryToken = await loginReady(MEMORY_PORT, "secretaire", "1234", "CD-2026-0001");
    const prefetToken = await loginReady(MEMORY_PORT, "prefet", "1234", "CD-2026-0001");
    assert.equal((await request(MEMORY_PORT, "/course-schedules", { token: adminToken })).status, 200);
    assert.equal((await request(MEMORY_PORT, "/course-schedules", { token: teacherToken })).status, 200);
    assert.equal((await request(MEMORY_PORT, "/course-schedules", { token: prefetToken })).status, 200);
    assertDenied(await request(MEMORY_PORT, "/course-schedules", { token: parentToken }), "parent GET mémoire");
    assertDenied(await request(MEMORY_PORT, "/course-schedules", { token: secretaryToken }), "secrétaire GET mémoire");
    assertDenied(
      await request(MEMORY_PORT, "/course-schedules", { method: "POST", token: teacherToken, body: {} }),
      "enseignant POST mémoire",
    );
    console.log("OK http-memory: RBAC Planning de cours");
  } finally {
    child.kill("SIGTERM");
    await wait(200);
  }
}

async function runPostgresHttp(databaseUrl) {
  const isolatedUrl = await prepareDatabase(databaseUrl);
  const pool = new Pool({ connectionString: isolatedUrl });
  const child = spawnBackend({ port: PG_PORT, databaseUrl: isolatedUrl });
  try {
    await waitForHealth(child, PG_PORT);
    const adminToken = await login(PG_PORT, "admin", "1234", "CD-2026-0001");
    const teacherToken = await login(PG_PORT, "ENS-0001", "1234", "CD-2026-0001");
    const prefetToken = await loginReady(PG_PORT, "prefet", "1234", "CD-2026-0001");
    const secretaryToken = await loginReady(PG_PORT, "secretaire", "1234", "CD-2026-0001");
    const parentToken = await login(PG_PORT, "+243 820 000 001", "1234", "CD-2026-0001");
    const yearId = (await pool.query(`SELECT id FROM academic_years LIMIT 1`)).rows[0].id;

    const courseA = await request(PG_PORT, "/courses", {
      method: "POST",
      token: adminToken,
      body: { className: "2ème A", name: "Mathématiques", teacherId: "ENS-0001" },
    });
    assert.equal(courseA.status, 201, JSON.stringify(courseA.data));
    const courseB = await request(PG_PORT, "/courses", {
      method: "POST",
      token: adminToken,
      body: { className: "2ème B", name: "Mathématiques", teacherId: "ENS-0001" },
    });
    assert.equal(courseB.status, 201, JSON.stringify(courseB.data));

    const weeklyBody = {
      schoolCourseId: courseA.data.schoolCourseId,
      academicYearId: yearId,
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "09:00",
    };
    const created = await request(PG_PORT, "/course-schedules", { method: "POST", token: adminToken, body: weeklyBody });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.ok(created.data.schoolCourseId);
    assert.ok(created.data.academicYearId);

    const byClass = await request(
      PG_PORT,
      `/course-schedules?academicYearId=${yearId}&classId=${created.data.classId}`,
      { token: adminToken },
    );
    assert.equal(byClass.status, 200);
    assert.ok(byClass.data.some((row) => row.id === created.data.id));

    const byTeacher = await request(PG_PORT, `/course-schedules?academicYearId=${yearId}`, { token: teacherToken });
    assert.equal(byTeacher.status, 200);
    assert.ok(byTeacher.data.some((row) => row.id === created.data.id));

    const classOverlap = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: adminToken,
      body: { ...weeklyBody, startTime: "08:30", endTime: "09:30" },
    });
    assert.equal(classOverlap.status, 409);
    assert.equal(classOverlap.data?.code, PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);

    const teacherOverlap = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: adminToken,
      body: {
        schoolCourseId: courseB.data.schoolCourseId,
        academicYearId: yearId,
        dayOfWeek: 1,
        startTime: "08:30",
        endTime: "09:30",
      },
    });
    assert.equal(teacherOverlap.status, 409);

    const adjacent = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: adminToken,
      body: { ...weeklyBody, startTime: "09:00", endTime: "10:00" },
    });
    assert.equal(adjacent.status, 201, JSON.stringify(adjacent.data));

    const tuesday = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: prefetToken,
      body: { ...weeklyBody, dayOfWeek: 2, startTime: "08:30", endTime: "09:30" },
    });
    assert.equal(tuesday.status, 201, JSON.stringify(tuesday.data));

    assertDenied(await request(PG_PORT, "/course-schedules", { token: parentToken }), "parent GET");
    assertDenied(await request(PG_PORT, "/course-schedules", { token: secretaryToken }), "secrétaire GET");
    assertDenied(
      await request(PG_PORT, "/course-schedules", { method: "POST", token: parentToken, body: weeklyBody }),
      "parent POST",
    );
    assertDenied(
      await request(PG_PORT, "/course-schedules", { method: "POST", token: teacherToken, body: weeklyBody }),
      "enseignant POST",
    );

    const foreign = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: adminToken,
      body: {
        schoolCourseId: "00000000-0000-0000-0000-000000000099",
        academicYearId: yearId,
        dayOfWeek: 3,
        startTime: "08:00",
        endTime: "09:00",
      },
    });
    assert.ok([403, 404].includes(foreign.status), `cross-tenant ${foreign.status}`);

    const patchConflict = await request(PG_PORT, `/course-schedules/${created.data.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { startTime: "08:30", endTime: "09:30" },
    });
    assert.equal(patchConflict.status, 409);

    const cancelled = await request(PG_PORT, `/course-schedules/${created.data.id}`, {
      method: "DELETE",
      token: adminToken,
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
    assert.equal(cancelled.data.cancelled, true);
    assert.equal(cancelled.data.deleted, false);

    const active = await request(PG_PORT, `/course-schedules?academicYearId=${yearId}`, { token: adminToken });
    assert.ok(!active.data.some((row) => row.id === created.data.id));
    const history = await pool.query(`SELECT status FROM course_schedule_weekly_slots WHERE id = $1`, [
      created.data.id,
    ]);
    assert.equal(history.rows[0].status, "cancelled");
    const audit = await pool.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE entity_id = $1 AND action = 'cancel_course_schedule'`,
      [created.data.id],
    );
    assert.ok(audit.rows[0].count >= 1);

    const occ = await request(
      PG_PORT,
      `/course-schedules?academicYearId=${yearId}&from=2026-09-01&to=2026-09-30`,
      { token: adminToken },
    );
    assert.equal(occ.data.projection, "occurrences");
    assert.ok(Array.isArray(occ.data.items));

    const concurrentBody = {
      schoolCourseId: courseB.data.schoolCourseId,
      academicYearId: yearId,
      dayOfWeek: 5,
      startTime: "08:00",
      endTime: "09:00",
    };
    const [one, two] = await Promise.all([
      request(PG_PORT, "/course-schedules", { method: "POST", token: adminToken, body: concurrentBody }),
      request(PG_PORT, "/course-schedules", { method: "POST", token: prefetToken, body: concurrentBody }),
    ]);
    const statuses = [one.status, two.status].sort();
    assert.deepEqual(statuses, [201, 409], `concurrence HTTP ${JSON.stringify([one.status, two.status])}`);

    console.log("OK http-pg: Planning V2 weekly canonical");
  } finally {
    child.kill("SIGTERM");
    await pool.end().catch(() => {});
    await wait(200);
  }
}

async function main() {
  assertPlanningWebUiEnabled();
  await runMemoryRbac();
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    await runPostgresHttp(databaseUrl);
  } else {
    console.log("verify-planning-v2-weekly: SKIP PG HTTP (DATABASE_URL absent)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
