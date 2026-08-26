"use strict";

/**
 * PostgreSQL réel — GET /api/mobile-sync/l1/course-schedules.
 * Autorité : course_schedule_weekly_slots. JOINs tenant-stricts, pas de trigger
 * de cohérence (les fuites volontaires l'exigeraient).
 * Prérequis : DATABASE_URL (CI). Base isolée.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createTeacherAssignmentsRepository } = require("../db/teacherAssignmentsRepository");
const { createCourseSchedulesRepository } = require("../db/courseSchedulesRepository");
const { TokenService } = require("../services/tokenService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { WEEKLY_SLOT_SELECT } = require("../db/pedagogyPgStore");
const { handleMobileSyncL1CourseSchedules } = require("./mobileSyncCourseSchedules");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_MOBILE_SYNC_L1_COURSE_SCHEDULES_IT_DATABASE ??
    "somafrik_mobile_sync_l1_course_schedules_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const CLASS_A = "aaaa1111-1111-4111-8111-111111111111";
const CLASS_B = "aaaa2222-2222-4222-8222-222222222222";
const CLASS_B_ONLY = "aaaa5555-5555-4555-8555-555555555555";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEACHER_B_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0b";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
const SLOT_MATH = "11111111-aaaa-4aaa-8aaa-111111111111";
const SLOT_FR = "22222222-aaaa-4aaa-8aaa-222222222222";
const SLOT_B_MATH = "33333333-aaaa-4aaa-8aaa-333333333333";
const SLOT_CANCELLED = "44444444-aaaa-4aaa-8aaa-444444444444";
const SLOT_ARCHIVED = "55555555-aaaa-4aaa-8aaa-555555555555";
const SLOT_ROOM = "66666666-aaaa-4aaa-8aaa-666666666666";
const SLOT_CROSS_COURSE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const SLOT_CROSS_CLASS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const SLOT_CROSS_TEACHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const SLOT_CROSS_YEAR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04";
const ROOM_A = "99999999-aaaa-4aaa-8aaa-99999999999a";
const ROOM_B = "99999999-aaaa-4aaa-8aaa-99999999999b";
const SAME_TS = "2026-08-26T08:00:00.000Z";
const LATER_TS = "2026-08-26T09:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_COURSE_SCHEDULES_IT_DATABASE invalide.");
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

async function setupFixture(pool) {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS countries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      iso_code VARCHAR(8) NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      school_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      class_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES schools(id),
      user_code VARCHAR(64) NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      user_id UUID REFERENCES users(id),
      teacher_code VARCHAR(64) NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      subject_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      teacher_id UUID NOT NULL REFERENCES teachers(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      subject_id UUID NOT NULL REFERENCES subjects(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      assignment_role TEXT NOT NULL DEFAULT 'primary',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS school_courses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      subject_id UUID NOT NULL REFERENCES subjects(id),
      teacher_id UUID REFERENCES teachers(id),
      course_code TEXT NOT NULL,
      coefficient NUMERIC(8, 2) NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT school_courses_status_check CHECK (status IN ('active', 'archived'))
    );
    CREATE TABLE IF NOT EXISTS school_rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      room_code TEXT NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS course_schedule_weekly_slots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      school_course_id UUID NOT NULL REFERENCES school_courses(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      teacher_id UUID NOT NULL REFERENCES teachers(id),
      day_of_week SMALLINT NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      room TEXT,
      room_id UUID REFERENCES school_rooms(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT course_schedule_weekly_slots_status_check
        CHECK (status IN ('active', 'cancelled', 'archived'))
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      school_id UUID REFERENCES schools(id),
      role_key TEXT NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_course_schedule_weekly_school_updated_at_id
      ON course_schedule_weekly_slots (school_id, updated_at, id);
  `);
  await pool.query(
    `TRUNCATE course_schedule_weekly_slots, school_rooms, school_courses, teacher_assignments,
              teachers, user_roles, users, subjects, classes, academic_years, schools, countries CASCADE`,
  );

  const country = await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('Testland', 'TT') RETURNING id`);
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name)
     VALUES ($1, 'SCH-A', 'École A'), ($1, 'SCH-B', 'École B')`,
    [country.rows[0].id],
  );
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
  const schoolA = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-A'`)).rows[0];
  const schoolB = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-B'`)).rows[0];
  return { schoolA: schoolA.id, schoolB: schoolB.id, yearA: yearA.id, yearB: yearB.id };
}

function createDbAdapter(pool) {
  return {
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      return (await pool.query(sql, params)).rows;
    },
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async getSchoolByCode(code) {
      const result = await pool.query(
        `SELECT id, school_code FROM schools WHERE school_code = $1 LIMIT 1`,
        [String(code ?? "").trim().toUpperCase()],
      );
      return result.rows[0] ?? null;
    },
  };
}

function adminPrincipal(overrides = {}) {
  return {
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Planning de cours:READ"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: TEACHER_USER_ID,
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    schoolCode: "SCH-A",
    permissions: ["Planning de cours:READ"],
    teacherCode: "JWT-CODE",
    teacherId: "JWT-CODE",
    ...overrides,
  };
}

function assertNoTenantBLeak(payload, ids) {
  const blob = JSON.stringify(payload);
  assert.equal(blob.includes(ids.schoolB), false, "schoolId B fuité");
  assert.equal(blob.includes(ids.yearB), false, "academicYear B fuité");
  assert.equal(blob.includes(CLASS_B_ONLY), false, "class B fuité");
  assert.equal(blob.includes(TEACHER_B_ID), false, "teacher B fuité");
  assert.equal(blob.includes(TEACHER_B_USER_ID), false, "user B fuité");
  assert.equal(blob.includes(SUBJECT_B), false, "subject B fuité");
  assert.equal(blob.includes(COURSE_B_ONLY), false, "course B fuité");
  assert.equal(blob.includes(ROOM_B), false, "room B fuité");
  assert.equal(blob.includes("TCH-SCH-B"), false);
  assert.equal(blob.includes("SUB-SCH-B"), false);
  assert.equal(blob.includes("CRS-CLS-B-ONLY"), false);
  assert.equal(blob.includes("SAL-B"), false);
  assert.equal(blob.toLowerCase().includes("benoit"), false);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncCourseSchedules.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
  const tenantScopeService = new TenantScopeService();

  try {
    const ids = await setupFixture(pool);
    const adapter = createDbAdapter(pool);
    const assignmentsRepo = createTeacherAssignmentsRepository(adapter);
    const schedulesRepo = createCourseSchedulesRepository(adapter);
    const liveRoleKeysByUser = new Map([
      ["admin-1", ["SCHOOL_ADMIN"]],
      [TEACHER_USER_ID, ["TEACHER"]],
    ]);
    let failLiveRoles = false;
    const repository = {
      getSchoolByCode: (code) => adapter.getSchoolByCode(code),
      listCourseSchedulesForMobileSync: (code, options) => schedulesRepo.listForMobileSync(code, options),
      getLiveTeacherIdentityForSchool: (userId, schoolId) =>
        assignmentsRepo.getLiveTeacherIdentityForSchool(userId, schoolId),
      listLiveTeacherAssignmentPairsForSync: (schoolId, teacherId) =>
        assignmentsRepo.listLiveTeacherAssignmentPairsForSync(schoolId, teacherId),
      async listActiveUserRoleKeys() {
        throw new Error("listActiveUserRoleKeys unscoped ne doit pas être appelé par mobile-sync");
      },
      async listActiveUserRoleKeysForSchool(userId, schoolId) {
        if (failLiveRoles) throw new Error("pg roles unavailable");
        const uid = String(userId ?? "").trim();
        const sid = String(schoolId ?? "").trim();
        if (!uid || !sid) return [];
        if (liveRoleKeysByUser.has(uid)) return liveRoleKeysByUser.get(uid) ?? [];
        return [];
      },
      async resolveEffectivePermissions(principal) {
        const keys = new Set(principal.roleKeys ?? []);
        if (keys.has("SCHOOL_ADMIN") || keys.has("TEACHER")) {
          return { permissions: ["Planning de cours:READ"] };
        }
        return { permissions: [] };
      },
    };

    async function sync(principal, { cursor, limit } = {}) {
      return handleMobileSyncL1CourseSchedules({
        principal,
        cursor,
        limit,
        tokenService: tokens,
        repository,
        tenantScopeService,
      });
    }

    await pool.query(
      `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
       VALUES
         ($1, $4, $6, 'CRS-CLS-A', '6ème A', 'active', $8::timestamptz),
         ($2, $4, $6, 'CRS-CLS-B', '6ème B', 'active', $8::timestamptz),
         ($3, $5, $7, 'CRS-CLS-B-ONLY', '5ème B', 'active', $8::timestamptz)`,
      [CLASS_A, CLASS_B, CLASS_B_ONLY, ids.schoolA, ids.schoolB, ids.yearA, ids.yearB, SAME_TS],
    );
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
       VALUES
         ($1, $3, 'TEACH-SCH-1', 'Tana', 'Kabila', 'Enseignant', 'active'),
         ($2, $4, 'TEACH-SCH-B', 'Benoit', 'Kanza', 'Enseignant', 'active')`,
      [TEACHER_USER_ID, TEACHER_B_USER_ID, ids.schoolA, ids.schoolB],
    );
    await pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES
         ($1, $3, $5, 'TCH-SCH-1', 'active'),
         ($2, $4, $6, 'TCH-SCH-B', 'active')`,
      [TEACHER_ID, TEACHER_B_ID, ids.schoolA, ids.schoolB, TEACHER_USER_ID, TEACHER_B_USER_ID],
    );
    await pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES
         ($1, $4, 'SUB-SCH-MATH', 'Maths', 'active'),
         ($2, $4, 'SUB-SCH-FR', 'Français', 'active'),
         ($3, $5, 'SUB-SCH-B', 'Physique B', 'active')`,
      [SUBJECT_MATH, SUBJECT_FR, SUBJECT_B, ids.schoolA, ids.schoolB],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::timestamptz)`,
      [ASSIGN_MATH, ids.schoolA, TEACHER_ID, CLASS_A, SUBJECT_MATH, ids.yearA, SAME_TS],
    );
    await pool.query(
      `INSERT INTO school_courses (
         id, school_id, class_id, subject_id, teacher_id, course_code, coefficient, status, updated_at
       ) VALUES
         ($1, $5, $6, $8, $10, 'CRS-A-MATH', 1, 'active', $12::timestamptz),
         ($2, $5, $6, $9, $10, 'CRS-A-FR', 1, 'active', $12::timestamptz),
         ($3, $5, $7, $8, $10, 'CRS-B-MATH', 1, 'active', $12::timestamptz),
         ($4, $11, $13, $14, $15, 'CRS-B-ONLY', 1, 'active', $12::timestamptz)`,
      [
        COURSE_MATH,
        COURSE_FR,
        COURSE_B_MATH,
        COURSE_B_ONLY,
        ids.schoolA,
        CLASS_A,
        CLASS_B,
        SUBJECT_MATH,
        SUBJECT_FR,
        TEACHER_ID,
        ids.schoolB,
        SAME_TS,
        CLASS_B_ONLY,
        SUBJECT_B,
        TEACHER_B_ID,
      ],
    );
    await pool.query(
      `INSERT INTO school_rooms (id, school_id, room_code, name)
       VALUES ($1, $3, 'SAL-A', 'Salle A'), ($2, $4, 'SAL-B', 'Salle B')`,
      [ROOM_A, ROOM_B, ids.schoolA, ids.schoolB],
    );
    await pool.query(
      `INSERT INTO course_schedule_weekly_slots (
         id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
         day_of_week, start_time, end_time, status, room_id, updated_at
       ) VALUES
         ($1, $7, $8, $9,  $12, $14, 1, '08:00', '09:00', 'active', $15, $16::timestamptz),
         ($2, $7, $8, $10, $12, $14, 1, '09:00', '10:00', 'active', NULL, $16::timestamptz),
         ($3, $7, $8, $11, $13, $14, 2, '08:00', '09:00', 'active', NULL, $16::timestamptz),
         ($4, $7, $8, $9,  $12, $14, 3, '08:00', '09:00', 'cancelled', NULL, $17::timestamptz),
         ($5, $7, $8, $9,  $12, $14, 4, '08:00', '09:00', 'archived', NULL, $17::timestamptz),
         ($6, $7, $8, $9,  $12, $14, 5, '08:00', '09:00', 'active', $15, $16::timestamptz)`,
      [
        SLOT_MATH,
        SLOT_FR,
        SLOT_B_MATH,
        SLOT_CANCELLED,
        SLOT_ARCHIVED,
        SLOT_ROOM,
        ids.schoolA,
        ids.yearA,
        COURSE_MATH,
        COURSE_FR,
        COURSE_B_MATH,
        CLASS_A,
        CLASS_B,
        TEACHER_ID,
        ROOM_A,
        SAME_TS,
        LATER_TS,
      ],
    );

    const cold = await sync(adminPrincipal());
    assert.equal(cold.httpStatus, 200, "Admin school-wide 200");
    assert.equal(cold.body.mode, "full");
    assert.equal(cold.body.resource, "course-schedules");
    const coldIds = cold.body.items.map((item) => item.id).sort();
    assert.deepEqual(
      coldIds,
      [SLOT_MATH, SLOT_FR, SLOT_B_MATH, SLOT_CANCELLED, SLOT_ARCHIVED, SLOT_ROOM].sort(),
    );
    const cancelled = cold.body.items.find((item) => item.id === SLOT_CANCELLED);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.tombstone, true);
    const archived = cold.body.items.find((item) => item.id === SLOT_ARCHIVED);
    assert.equal(archived.status, "archived");
    assert.equal(archived.tombstone, true);
    const math = cold.body.items.find((item) => item.id === SLOT_MATH);
    assert.equal(math.dayOfWeek, 1);
    assert.equal(math.startTime, "08:00");
    assert.equal(math.endTime, "09:00");
    assert.equal(math.roomId, ROOM_A);
    assert.equal(Object.hasOwn(math, "className"), false);
    assert.ok(!cold.body.items.some((item) => item.classCode === "CRS-CLS-B-ONLY"));

    await pool.query("SET enable_seqscan = off");
    const schoolPlan = JSON.stringify(
      (
        await pool.query(
          `EXPLAIN (FORMAT JSON)
           SELECT w.id FROM course_schedule_weekly_slots w
           WHERE w.school_id = $1
           ORDER BY w.updated_at ASC, w.id ASC
           LIMIT 50`,
          [ids.schoolA],
        )
      ).rows,
    );
    assert.match(schoolPlan, /idx_course_schedule_weekly_school_updated_at_id/, "index school-wide keyset");
    const teacherPlan = JSON.stringify(
      (
        await pool.query(
          `EXPLAIN (FORMAT JSON)
           SELECT w.id FROM course_schedule_weekly_slots w
           JOIN teachers t ON t.id = w.teacher_id AND t.school_id = w.school_id
           WHERE w.school_id = $1 AND t.id = ANY($2::uuid[])
           ORDER BY w.updated_at ASC, w.id ASC
           LIMIT 50`,
          [ids.schoolA, [TEACHER_ID]],
        )
      ).rows,
    );
    assert.match(
      teacherPlan,
      /idx_course_schedule_weekly_school_updated_at_id/,
      "Teacher keyset réutilise l'index school-wide ; pas d'index (school_id, teacher_id, updated_at, id) spéculatif",
    );
    await pool.query("SET enable_seqscan = on");
    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'course_schedule_weekly_slots'
         AND indexname = 'idx_course_schedule_weekly_school_updated_at_id'`,
    );
    assert.equal(indexes.rowCount, 1);
    const teacherIndex = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'course_schedule_weekly_slots'
         AND indexname = 'idx_course_schedule_weekly_teacher_updated_at_id'`,
    );
    assert.equal(teacherIndex.rowCount, 0, "pas d'index Teacher spéculatif");

    const teacher = await sync(teacherPrincipal());
    assert.deepEqual(
      teacher.body.items.map((item) => item.id).sort(),
      [SLOT_MATH, SLOT_CANCELLED, SLOT_ARCHIVED, SLOT_ROOM].sort(),
    );
    assert.ok(!teacher.body.items.some((item) => item.id === SLOT_FR));
    assert.ok(!teacher.body.items.some((item) => item.id === SLOT_B_MATH));
    assert.equal(teacher.body.items.find((item) => item.id === SLOT_CANCELLED)?.tombstone, true);

    const SLOT_NEW = "77777777-aaaa-4aaa-8aaa-777777777777";
    await pool.query(
      `INSERT INTO course_schedule_weekly_slots (
         id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
         day_of_week, start_time, end_time, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 6, '11:00', '12:00', 'active', $7::timestamptz)`,
      [SLOT_NEW, ids.schoolA, ids.yearA, COURSE_FR, CLASS_A, TEACHER_ID, "2026-08-26T10:00:00.000Z"],
    );
    const delta = await sync(adminPrincipal(), { cursor: cold.body.nextCursor });
    assert.equal(delta.body.mode, "delta");
    assert.ok(delta.body.items.some((item) => item.id === SLOT_NEW));

    const page1 = await sync(adminPrincipal(), { limit: 2 });
    assert.equal(page1.body.hasMore, true);
    assert.equal(page1.body.items.length, 2);
    const page2 = await sync(adminPrincipal(), { cursor: page1.body.nextCursor, limit: 20 });
    const allIds = [...page1.body.items, ...page2.body.items].map((item) => item.id);
    assert.equal(new Set(allIds).size, allIds.length, "pagination sans doublon");
    assert.ok(allIds.includes(SLOT_MATH));
    assert.ok(allIds.includes(SLOT_NEW));

    await pool.query(
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
        ids.schoolA,
        ids.yearA,
        ids.yearB,
        COURSE_B_ONLY,
        COURSE_MATH,
        CLASS_A,
        CLASS_B_ONLY,
        TEACHER_ID,
        TEACHER_B_ID,
      ],
    );
    await pool.query(`UPDATE school_courses SET subject_id = $1 WHERE id = $2`, [SUBJECT_B, COURSE_FR]);
    await pool.query(`UPDATE course_schedule_weekly_slots SET room_id = $1 WHERE id = $2`, [
      ROOM_B,
      SLOT_ROOM,
    ]);
    await pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES ($1, $2, $3, 'TCH-SCH-ORPHAN', 'active')`,
      [TEACHER_ORPHAN_ID, ids.schoolA, TEACHER_B_USER_ID],
    );

    const leaks = await sync(adminPrincipal());
    assert.equal(leaks.httpStatus, 200);
    const leakIds = new Set(leaks.body.items.map((item) => item.id));
    assert.equal(leakIds.has(SLOT_CROSS_COURSE), false, "slot A → course B exclu");
    assert.equal(leakIds.has(SLOT_CROSS_CLASS), false, "slot A → class B exclu");
    assert.equal(leakIds.has(SLOT_CROSS_TEACHER), false, "slot A → teacher B exclu");
    assert.equal(leakIds.has(SLOT_CROSS_YEAR), false, "slot A → year B exclu");
    assert.equal(leakIds.has(SLOT_FR), false, "course A → subject B exclut le créneau");
    const roomRow = leaks.body.items.find((item) => item.id === SLOT_ROOM);
    assert.ok(roomRow, "room cross-tenant : ligne conservée");
    assert.equal(roomRow.roomId, null);
    assert.equal(roomRow.roomCode, null);
    assertNoTenantBLeak(leaks.body, ids);

    const historic = await pool.query(`${WEEKLY_SLOT_SELECT} WHERE w.school_id = $1`, [ids.schoolA]);
    const historicIds = new Set(historic.rows.map((row) => String(row.id)));
    assert.equal(historicIds.has(SLOT_CROSS_COURSE), false);
    assert.equal(historicIds.has(SLOT_CROSS_CLASS), false);
    assert.equal(historicIds.has(SLOT_CROSS_TEACHER), false);
    assert.equal(historicIds.has(SLOT_CROSS_YEAR), false);
    const historicRoom = historic.rows.find((row) => String(row.id) === SLOT_ROOM);
    assert.ok(historicRoom);
    assert.equal(historicRoom.room_id, null);
    assert.equal(historicRoom.room_code, null);
    const historicBlob = JSON.stringify(historic.rows);
    assert.equal(historicBlob.includes(TEACHER_B_ID), false);
    assert.equal(historicBlob.includes(TEACHER_B_USER_ID), false);
    assert.equal(historicBlob.includes(ROOM_B), false);
    assert.equal(historicBlob.toLowerCase().includes("benoit"), false);

    failLiveRoles = true;
    const liveFail = await sync(adminPrincipal());
    assert.equal(liveFail.httpStatus, 503);
    assert.equal(liveFail.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);

    console.log("mobileSyncCourseSchedules.pg.test.js: OK school-wide/teacher-pairs/tombstone/tenant/EXPLAIN");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
