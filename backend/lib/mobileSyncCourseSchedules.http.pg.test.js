"use strict";

/**
 * HTTP réel — Express → JWT → RBAC live → tenant → PostgreSQL.
 * CourseSchedules L1 + régression GET /api/course-schedules (SELECT partagé).
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { MOBILE_SYNC_ERROR, MOBILE_SYNC_CURSOR_TYP, MOBILE_SYNC_GENERATION } = require("./mobileSyncErrors");
const { PERMISSION_DENIED } = require("../services/rbacService");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_MOBILE_SYNC_L1_COURSE_SCHEDULES_HTTP_IT_DATABASE ??
    "somafrik_mobile_sync_l1_course_schedules_http_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_MOBILE_SYNC_L1_COURSE_SCHEDULES_HTTP_PORT ?? 19868);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const CLASS_B_ONLY = "55555555-5555-4555-8555-555555555555";
const ADMIN_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ACCOUNTANT_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const CUSTOM_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEACHER_B_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0b";
const TEACHER_B_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccbb";
const TEACHER_ORPHAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc0d";
const SUBJECT_MATH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT_FR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0f";
const SUBJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0b";
const COURSE_MATH = "dddddddd-dddd-4ddd-8ddd-dddddddddd0a";
const COURSE_FR = "dddddddd-dddd-4ddd-8ddd-dddddddddd0b";
const COURSE_B_MATH = "dddddddd-dddd-4ddd-8ddd-dddddddddd0c";
const COURSE_B_ONLY = "dddddddd-dddd-4ddd-8ddd-dddddddddd0e";
const ASSIGN_MATH = "ffffffff-ffff-4fff-8fff-ffffffffff0a";
const ASSIGN_FR = "ffffffff-ffff-4fff-8fff-ffffffffff0b";
const SLOT_MATH = "11111111-aaaa-4aaa-8aaa-111111111111";
const SLOT_FR = "22222222-aaaa-4aaa-8aaa-222222222222";
const SLOT_B_MATH = "33333333-aaaa-4aaa-8aaa-333333333333";
const SLOT_ROOM = "66666666-aaaa-4aaa-8aaa-666666666666";
const SLOT_CROSS_COURSE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const SLOT_CROSS_CLASS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const SLOT_CROSS_TEACHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const SLOT_CROSS_YEAR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04";
const ROOM_A = "99999999-aaaa-4aaa-8aaa-99999999999a";
const ROOM_B = "99999999-aaaa-4aaa-8aaa-99999999999b";
const SAME_TS = "2026-08-26T08:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_COURSE_SCHEDULES_HTTP_IT_DATABASE invalide.");
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
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

async function request(pathname, { method = "GET", token } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Backend health timeout");
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function mintAccess(tokens, payload) {
  return tokens.createAccessToken({
    mustChangePassword: false,
    ...payload,
  });
}

async function grantRolePlanningRead(pool, roleKey) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = $1
       AND module_key = 'planning'
       AND scope_type = 'global'
       AND status = 'active'
     LIMIT 1`,
    [String(roleKey).toUpperCase()],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_read = TRUE, updated_by = 'mobile-sync-http-it', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', 'planning', FALSE, TRUE, FALSE, FALSE, 'mobile-sync-http-it')`,
    [String(roleKey).toUpperCase()],
  );
}

function activeIds(payload) {
  return (payload?.items ?? [])
    .filter((item) => !item.tombstone)
    .map((item) => String(item.id))
    .sort();
}

function historicIds(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.items ?? [];
  return rows.map((item) => String(item.id)).sort();
}

async function seedHttpFixture(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('Testland', 'TT', '+000', 'XOF') RETURNING id`,
  );
  const countryId = country.rows[0].id;
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'SCH-A', 'École A', 'active'), ($1, 'SCH-B', 'École B', 'active')`,
    [countryId],
  );
  const schoolA = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-A'`)).rows[0];
  const schoolB = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-B'`)).rows[0];
  await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     SELECT id, '2025-2026', 'open' FROM schools WHERE school_code IN ('SCH-A', 'SCH-B')`,
  );
  const yearA = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-A' LIMIT 1`,
    )
  ).rows[0];
  const yearB = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-B' LIMIT 1`,
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES
       ($1, $3, $4, 'SCH-HTTP-A', '6ème A', 'active', $5::timestamptz),
       ($2, $3, $4, 'SCH-HTTP-B', '6ème B', 'active', $5::timestamptz)`,
    [CLASS_A, CLASS_B, schoolA.id, yearA.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES ($1, $2, $3, 'SCH-HTTP-B-ONLY', '5ème B', 'active', $4::timestamptz)`,
    [CLASS_B_ONLY, schoolB.id, yearB.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, 'ADM-SCH-1', 'Aline', 'Moke', 'admin-sch@test.local', 'Admin School', 'active', FALSE),
       ($2, $4, 'TCH-SCH-1', 'Tana', 'Kabila', 'teacher-sch@test.local', 'Enseignant', 'active', FALSE),
       ($3, $4, 'ACC-SCH-1', 'Carla', 'Ngo', 'accountant-sch@test.local', 'Comptable', 'active', FALSE)`,
    [ADMIN_USER_ID, TEACHER_USER_ID, ACCOUNTANT_USER_ID, schoolA.id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $4, 'SCHOOL_ADMIN', 'active'),
       ($2, $4, 'TEACHER', 'active'),
       ($3, $4, 'ACCOUNTANT', 'active')`,
    [ADMIN_USER_ID, TEACHER_USER_ID, ACCOUNTANT_USER_ID, schoolA.id],
  );
  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES ($1, $2, $3, 'TCH-SCH-1', 'active')`,
    [TEACHER_ID, schoolA.id, TEACHER_USER_ID],
  );
  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name, status)
     VALUES
       ($1, $3, 'SUB-SCH-MATH', 'Maths', 'active'),
       ($2, $3, 'SUB-SCH-FR', 'Français', 'active')`,
    [SUBJECT_MATH, SUBJECT_FR, schoolA.id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (
       id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::timestamptz)`,
    [ASSIGN_MATH, schoolA.id, TEACHER_ID, CLASS_A, SUBJECT_MATH, yearA.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO school_courses (
       id, school_id, class_id, subject_id, teacher_id, course_code, coefficient, status, updated_at
     ) VALUES
       ($1, $4, $5, $7, $9, 'CRS-HTTP-MATH', 1, 'active', $10::timestamptz),
       ($2, $4, $5, $8, $9, 'CRS-HTTP-FR', 1, 'active', $10::timestamptz),
       ($3, $4, $6, $7, $9, 'CRS-HTTP-B-MATH', 1, 'active', $10::timestamptz)`,
    [
      COURSE_MATH,
      COURSE_FR,
      COURSE_B_MATH,
      schoolA.id,
      CLASS_A,
      CLASS_B,
      SUBJECT_MATH,
      SUBJECT_FR,
      TEACHER_ID,
      SAME_TS,
    ],
  );
  await pool.query(
    `INSERT INTO school_rooms (id, school_id, room_code, name, status)
     VALUES ($1, $2, 'SAL-0001', 'Salle A', 'active')`,
    [ROOM_A, schoolA.id],
  );
  await pool.query(
    `INSERT INTO course_schedule_weekly_slots (
       id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
       day_of_week, start_time, end_time, status, room_id, updated_at
     ) VALUES
       ($1, $5, $6, $7, $10, $12, 1, '08:00', '09:00', 'active', $13, $14::timestamptz),
       ($2, $5, $6, $8, $10, $12, 1, '09:00', '10:00', 'active', NULL, $14::timestamptz),
       ($3, $5, $6, $9, $11, $12, 2, '08:00', '09:00', 'active', NULL, $14::timestamptz),
       ($4, $5, $6, $7, $10, $12, 5, '08:00', '09:00', 'active', $13, $14::timestamptz)`,
    [
      SLOT_MATH,
      SLOT_FR,
      SLOT_B_MATH,
      SLOT_ROOM,
      schoolA.id,
      yearA.id,
      COURSE_MATH,
      COURSE_FR,
      COURSE_B_MATH,
      CLASS_A,
      CLASS_B,
      TEACHER_ID,
      ROOM_A,
      SAME_TS,
    ],
  );
  return { schoolA: schoolA.id, schoolB: schoolB.id, yearA: yearA.id, yearB: yearB.id };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncCourseSchedules.http.pg.test.js: DATABASE_URL absent");
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
  let stderr = "";

  try {
    await repo.init();
    await grantRolePlanningRead(repo.pool, "TEACHER");
    await grantRolePlanningRead(repo.pool, "CUSTOM_ROLE");
    const fixture = await seedHttpFixture(repo.pool);

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
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", () => {});

    await waitForHealth(child);

    const adminToken = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Planning de cours:READ", "ALL_PRIVILEGES"],
    });
    const teacherToken = mintAccess(tokens, {
      sub: TEACHER_USER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: "SCH-A",
      permissions: ["Planning de cours:READ"],
      teacherCode: "JWT-CODE",
      teacherId: "JWT-CODE",
    });
    const accountantToken = mintAccess(tokens, {
      sub: ACCOUNTANT_USER_ID,
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      schoolCode: "SCH-A",
      permissions: ["Gérer paiements"],
    });
    const staleAdminOnTeacher = mintAccess(tokens, {
      sub: TEACHER_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Planning de cours:READ", "ALL_PRIVILEGES"],
    });

    const admin = await request("/mobile-sync/l1/course-schedules", { token: adminToken });
    assert.equal(admin.status, 200, `Admin L1: ${JSON.stringify(admin.data)}`);
    assert.equal(admin.data.mode, "full");
    assert.equal(admin.data.resource, "course-schedules");
    assert.deepEqual(activeIds(admin.data), [SLOT_MATH, SLOT_FR, SLOT_B_MATH, SLOT_ROOM].sort());
    for (const item of admin.data.items ?? []) {
      assert.equal(Object.hasOwn(item, "className"), false);
      assert.equal(Object.hasOwn(item, "subjectName"), false);
      assert.equal(item.dayOfWeek >= 1 && item.dayOfWeek <= 7, true);
    }

    const historicOk = await request("/course-schedules", { token: adminToken });
    assert.equal(historicOk.status, 200, `GET historique: ${JSON.stringify(historicOk.data)?.slice(0, 400)}`);
    assert.deepEqual(historicIds(historicOk.data), [SLOT_MATH, SLOT_FR, SLOT_B_MATH, SLOT_ROOM].sort());

    const teacher = await request("/mobile-sync/l1/course-schedules", { token: teacherToken });
    assert.equal(teacher.status, 200, `Teacher L1: ${JSON.stringify(teacher.data)}`);
    assert.deepEqual(activeIds(teacher.data), [SLOT_MATH, SLOT_ROOM].sort());
    assert.ok(!(teacher.data.items ?? []).some((item) => item.id === SLOT_FR || item.id === SLOT_B_MATH));

    const accountant = await request("/mobile-sync/l1/course-schedules", { token: accountantToken });
    assert.equal(accountant.status, 403);
    assert.equal(accountant.data?.code, PERMISSION_DENIED);

    const stale = await request("/mobile-sync/l1/course-schedules", { token: staleAdminOnTeacher });
    assert.deepEqual(activeIds(stale.data), [SLOT_MATH, SLOT_ROOM].sort());

    await repo.pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())`,
      [ASSIGN_FR, fixture.schoolA, TEACHER_ID, CLASS_A, SUBJECT_FR, fixture.yearA],
    );
    const scopeChanged = await request(
      `/mobile-sync/l1/course-schedules?cursor=${encodeURIComponent(teacher.data.nextCursor)}`,
      { token: teacherToken },
    );
    assert.equal(scopeChanged.status, 409, `scope_changed 409: ${JSON.stringify(scopeChanged.data)}`);
    assert.equal(scopeChanged.data?.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
    assert.equal(scopeChanged.data?.mode, "full_required");
    assert.equal(scopeChanged.data?.cursorStatus, "scope_changed");

    const classesCursor = encodeMobileSyncCursor(
      {
        resource: "school-courses",
        schoolCode: "SCH-A",
        schoolId: fixture.schoolA,
        principalId: ADMIN_USER_ID,
        scopeHash: admin.data.scopeHash,
        lastUpdatedAt: SAME_TS,
        lastId: SLOT_MATH,
      },
      tokens,
    );
    const classesOnSchedules = await request(
      `/mobile-sync/l1/course-schedules?cursor=${encodeURIComponent(classesCursor)}`,
      { token: adminToken },
    );
    assert.equal(classesOnSchedules.status, 400);
    assert.equal(classesOnSchedules.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const tampered = `${admin.data.nextCursor.slice(0, -4)}xxxx`;
    const tamper = await request(`/mobile-sync/l1/course-schedules?cursor=${encodeURIComponent(tampered)}`, {
      token: adminToken,
    });
    assert.equal(tamper.status, 400);
    assert.equal(tamper.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const tenantToken = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-B",
      permissions: ["Planning de cours:READ", "ALL_PRIVILEGES"],
    });
    const tenant = await request(
      `/mobile-sync/l1/course-schedules?cursor=${encodeURIComponent(admin.data.nextCursor)}`,
      { token: tenantToken },
    );
    assert.equal(tenant.status, 403);
    assert.equal(tenant.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const expired = tokens.sign(
      {
        typ: MOBILE_SYNC_CURSOR_TYP,
        sv: 99,
        gen: MOBILE_SYNC_GENERATION,
        resource: "course-schedules",
        schoolCode: "SCH-A",
        schoolId: fixture.schoolA,
        principalId: ADMIN_USER_ID,
        scopeHash: admin.data.scopeHash,
        lastUpdatedAt: SAME_TS,
        lastId: SLOT_MATH,
      },
      3600,
    );
    const expiredRes = await request(`/mobile-sync/l1/course-schedules?cursor=${encodeURIComponent(expired)}`, {
      token: adminToken,
    });
    assert.equal(expiredRes.status, 409);
    assert.equal(expiredRes.data?.code, MOBILE_SYNC_ERROR.CURSOR_EXPIRED);
    assert.equal(expiredRes.data?.mode, "full_required");

    await repo.pool.query(
      `UPDATE course_schedule_weekly_slots SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [SLOT_FR],
    );
    await repo.pool.query(
      `UPDATE course_schedule_weekly_slots SET status = 'archived', updated_at = NOW() WHERE id = $1`,
      [SLOT_B_MATH],
    );
    const afterCancel = await request("/mobile-sync/l1/course-schedules", { token: adminToken });
    const cancelled = (afterCancel.data.items ?? []).find((item) => item.id === SLOT_FR);
    assert.equal(cancelled?.tombstone, true);
    assert.equal(cancelled?.status, "cancelled");
    const archived = (afterCancel.data.items ?? []).find((item) => item.id === SLOT_B_MATH);
    assert.equal(archived?.tombstone, true);
    assert.equal(archived?.status, "archived");
    const historicAfter = await request("/course-schedules", { token: adminToken });
    assert.equal(historicIds(historicAfter.data).includes(SLOT_FR), false, "GET historique masque cancelled");
    assert.equal(historicIds(historicAfter.data).includes(SLOT_B_MATH), false, "GET historique masque archived");

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'TCH-SCH-B', 'Benoit', 'Kanza', 'teacher-b-sch@test.local', 'Enseignant', 'active', FALSE)`,
      [TEACHER_B_USER_ID, fixture.schoolB],
    );
    await repo.pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES
         ($1, $3, $4, 'TCH-SCH-B', 'active'),
         ($2, $5, $4, 'TCH-SCH-ORPHAN', 'active')`,
      [TEACHER_B_ID, TEACHER_ORPHAN_ID, fixture.schoolB, TEACHER_B_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES ($1, $2, 'SUB-SCH-B', 'Physique B', 'active')`,
      [SUBJECT_B, fixture.schoolB],
    );
    await repo.pool.query(
      `INSERT INTO school_courses (
         id, school_id, class_id, subject_id, teacher_id, course_code, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'CRS-B-ONLY', 'active', NOW())`,
      [COURSE_B_ONLY, fixture.schoolB, CLASS_B_ONLY, SUBJECT_B, TEACHER_B_ID],
    );
    await repo.pool.query(
      `INSERT INTO school_rooms (id, school_id, room_code, name, status)
       VALUES ($1, $2, 'SAL-0002', 'Salle B', 'active')`,
      [ROOM_B, fixture.schoolB],
    );

    await repo.pool.query("ALTER TABLE course_schedule_weekly_slots DISABLE TRIGGER USER");
    await repo.pool.query(
      `INSERT INTO course_schedule_weekly_slots (
         id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
         day_of_week, start_time, end_time, status, updated_at
       ) VALUES
         ($1, $5, $6, $8,  $10, $12, 1, '14:00', '15:00', 'active', NOW()),
         ($2, $5, $6, $9,  $11, $12, 1, '15:00', '16:00', 'active', NOW()),
         ($3, $5, $6, $9,  $10, $13, 1, '16:00', '17:00', 'active', NOW()),
         ($4, $5, $7, $9,  $10, $12, 1, '17:00', '18:00', 'active', NOW())`,
      [
        SLOT_CROSS_COURSE,
        SLOT_CROSS_CLASS,
        SLOT_CROSS_TEACHER,
        SLOT_CROSS_YEAR,
        fixture.schoolA,
        fixture.yearA,
        fixture.yearB,
        COURSE_B_ONLY,
        COURSE_MATH,
        CLASS_A,
        CLASS_B_ONLY,
        TEACHER_ID,
        TEACHER_B_ID,
      ],
    );
    await repo.pool.query(`UPDATE school_courses SET subject_id = $1 WHERE id = $2`, [SUBJECT_B, COURSE_FR]);
    await repo.pool.query(`UPDATE course_schedule_weekly_slots SET room_id = $1 WHERE id = $2`, [ROOM_B, SLOT_ROOM]);
    await repo.pool.query(`UPDATE teachers SET user_id = $1 WHERE id = $2`, [TEACHER_B_USER_ID, TEACHER_ORPHAN_ID]);

    const leak = await request("/mobile-sync/l1/course-schedules", { token: adminToken });
    assert.equal(leak.status, 200, `L1 leak: ${JSON.stringify(leak.data)}`);
    const leakItems = leak.data.items ?? [];
    const leakIds = new Set(leakItems.map((item) => item.id));
    assert.equal(leakIds.has(SLOT_CROSS_COURSE), false);
    assert.equal(leakIds.has(SLOT_CROSS_CLASS), false);
    assert.equal(leakIds.has(SLOT_CROSS_TEACHER), false);
    assert.equal(leakIds.has(SLOT_CROSS_YEAR), false);
    assert.equal(leakIds.has(SLOT_FR), false, "course A → subject B exclut le créneau FR");
    assert.equal(leakIds.has(SLOT_MATH), true, "créneau Maths sain toujours visible");
    const roomRow = leakItems.find((item) => item.id === SLOT_ROOM);
    assert.ok(roomRow);
    assert.equal(roomRow.roomId, null);
    assert.equal(roomRow.roomCode, null);
    const leakBlob = JSON.stringify(leakItems);
    assert.equal(leakBlob.includes(TEACHER_B_ID), false);
    assert.equal(leakBlob.includes(TEACHER_B_USER_ID), false);
    assert.equal(leakBlob.includes(CLASS_B_ONLY), false);
    assert.equal(leakBlob.includes(SUBJECT_B), false);
    assert.equal(leakBlob.includes(ROOM_B), false);
    assert.equal(leakBlob.includes(fixture.yearB), false);
    assert.equal(leakBlob.toLowerCase().includes("benoit"), false);

    const historicLeak = await request("/course-schedules", { token: adminToken });
    assert.equal(historicLeak.status, 200);
    const historicRows = Array.isArray(historicLeak.data) ? historicLeak.data : historicLeak.data?.items ?? [];
    const historicLeakIds = new Set(historicRows.map((item) => String(item.id)));
    assert.equal(historicLeakIds.has(SLOT_CROSS_COURSE), false);
    assert.equal(historicLeakIds.has(SLOT_CROSS_CLASS), false);
    assert.equal(historicLeakIds.has(SLOT_CROSS_TEACHER), false);
    assert.equal(historicLeakIds.has(SLOT_CROSS_YEAR), false);
    const historicRoom = historicRows.find((item) => String(item.id) === SLOT_ROOM);
    assert.ok(historicRoom);
    assert.equal(historicRoom.roomId, null);
    const historicBlob = JSON.stringify(historicRows);
    assert.equal(historicBlob.includes(TEACHER_B_ID), false);
    assert.equal(historicBlob.includes(TEACHER_B_USER_ID), false);
    assert.equal(historicBlob.includes(ROOM_B), false);
    assert.equal(historicBlob.toLowerCase().includes("benoit"), false);

    await repo.pool.query("ALTER TABLE course_schedule_weekly_slots ENABLE TRIGGER USER");

    await repo.pool.query(
      `UPDATE role_module_permissions
       SET can_read = FALSE, updated_at = NOW()
       WHERE upper(role_key) = 'TEACHER'
         AND module_key = 'planning'
         AND status = 'active'`,
    );
    const permRevoked = await request("/mobile-sync/l1/course-schedules", { token: teacherToken });
    assert.equal(permRevoked.status, 403, `permission live 403: ${JSON.stringify(permRevoked.data)}`);
    assert.equal(permRevoked.data?.code, PERMISSION_DENIED);

    await repo.pool.query(
      `UPDATE role_module_permissions
       SET can_read = TRUE, updated_at = NOW()
       WHERE upper(role_key) = 'TEACHER'
         AND module_key = 'planning'
         AND status = 'active'`,
    );

    await repo.pool.query(
      `UPDATE user_roles
       SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [TEACHER_USER_ID],
    );
    const teacherRoleRevoked = await request("/mobile-sync/l1/course-schedules", { token: teacherToken });
    assert.equal(teacherRoleRevoked.status, 200);
    assert.deepEqual(teacherRoleRevoked.data.items ?? [], []);

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'CUS-SCH-1', 'Cyrus', 'Ndala', 'custom-sch@test.local', NULL, 'active', FALSE)`,
      [CUSTOM_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'CUSTOM_ROLE', 'active')`,
      [CUSTOM_USER_ID, fixture.schoolA],
    );
    const customToken = mintAccess(tokens, {
      sub: CUSTOM_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Planning de cours:READ", "ALL_PRIVILEGES"],
    });
    const customRole = await request("/mobile-sync/l1/course-schedules", { token: customToken });
    assert.equal(customRole.status, 200);
    assert.deepEqual(customRole.data.items ?? [], []);

    console.log("mobileSyncCourseSchedules.http.pg.test.js: OK Express/JWT/RBAC/live/tenant/GET-historique");
  } catch (error) {
    if (stderr) {
      console.error(stderr.slice(-4000));
    }
    throw error;
  } finally {
    await stopChild(child);
    if (repo?.pool) {
      await repo.pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
