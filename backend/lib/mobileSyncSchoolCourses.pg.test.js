"use strict";

/**
 * PostgreSQL réel — GET /api/mobile-sync/l1/school-courses.
 * Prérequis : DATABASE_URL (CI). Base isolée.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createTeacherAssignmentsRepository } = require("../db/teacherAssignmentsRepository");
const { createSchoolCoursesRepository } = require("../db/schoolCoursesRepository");
const { TokenService } = require("../services/tokenService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { handleMobileSyncL1SchoolCourses } = require("./mobileSyncSchoolCourses");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_MOBILE_SYNC_L1_SCHOOL_COURSES_IT_DATABASE ??
    "somafrik_mobile_sync_l1_school_courses_it",
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
const COURSE_ARCHIVED = "dddddddd-dddd-4ddd-8ddd-dddddddddd0d";
const COURSE_CROSS_CLASS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const COURSE_CROSS_SUBJECT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const ASSIGN_MATH = "ffffffff-ffff-4fff-8fff-ffffffffff0a";
const SAME_TS = "2026-08-26T08:00:00.000Z";
const LATER_TS = "2026-08-26T09:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_SCHOOL_COURSES_IT_DATABASE invalide.");
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
      login_code TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS login_code TEXT;
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
    CREATE TABLE IF NOT EXISTS user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      school_id UUID REFERENCES schools(id),
      role_key TEXT NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_school_courses_school_updated_at_id
      ON school_courses (school_id, updated_at, id);
  `);
  await pool.query(
    "TRUNCATE school_courses, teacher_assignments, teachers, user_roles, users, subjects, classes, academic_years, schools, countries CASCADE",
  );

  const country = await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('Testland', 'TT') RETURNING id`);
  await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name)
     VALUES ($1, 'SCH-A', 'CD-CO-26-001', 'École A'),
            ($1, 'SCH-B', 'CD-CP-26-001', 'École B')`,
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
        `SELECT id, school_code, login_code FROM schools WHERE upper(login_code) = $1 LIMIT 1`,
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
    schoolCode: "CD-CO-26-001",
    permissions: ["Matières:READ", "Voir classes"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: TEACHER_USER_ID,
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    schoolCode: "CD-CO-26-001",
    permissions: ["Matières:READ", "Voir classes"],
    teacherCode: "JWT-CODE",
    teacherId: "JWT-CODE",
    ...overrides,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncSchoolCourses.pg.test.js: DATABASE_URL absent");
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
    const coursesRepo = createSchoolCoursesRepository(adapter);
    const liveRoleKeysByUser = new Map([
      ["admin-1", ["SCHOOL_ADMIN"]],
      [TEACHER_USER_ID, ["TEACHER"]],
    ]);
    let failLiveRoles = false;
    const repository = {
      getSchoolByCode: (code) => adapter.getSchoolByCode(code),
      listSchoolCoursesForMobileSync: (code, options) => coursesRepo.listForMobileSync(code, options),
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
          return { permissions: ["Matières:READ", "Voir classes"] };
        }
        return { permissions: [] };
      },
    };

    async function sync(principal, { cursor, limit } = {}) {
      return handleMobileSyncL1SchoolCourses({
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
         ($1, $3, 'TEACH-CRS-1', 'Tana', 'Kabila', 'Enseignant', 'active'),
         ($2, $4, 'TEACH-CRS-B', 'Benoit', 'Kanza', 'Enseignant', 'active')`,
      [TEACHER_USER_ID, TEACHER_B_USER_ID, ids.schoolA, ids.schoolB],
    );
    await pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES
         ($1, $3, $5, 'TCH-CRS-1', 'active'),
         ($2, $4, $6, 'TCH-CRS-B', 'active')`,
      [TEACHER_ID, TEACHER_B_ID, ids.schoolA, ids.schoolB, TEACHER_USER_ID, TEACHER_B_USER_ID],
    );
    await pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES
         ($1, $4, 'SUB-CRS-MATH', 'Maths', 'active'),
         ($2, $4, 'SUB-CRS-FR', 'Français', 'active'),
         ($3, $5, 'SUB-CRS-B', 'Physique B', 'active')`,
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
         ($1, $5, $6, $8, $10, 'CRS-A-MATH', 1, 'active', $11::timestamptz),
         ($2, $5, $6, $9, $10, 'CRS-A-FR', 1, 'active', $11::timestamptz),
         ($3, $5, $7, $8, $10, 'CRS-B-MATH', 1, 'active', $11::timestamptz),
         ($4, $5, $6, $8, $10, 'CRS-A-OLD', 1, 'archived', $12::timestamptz)`,
      [
        COURSE_MATH,
        COURSE_FR,
        COURSE_B_MATH,
        COURSE_ARCHIVED,
        ids.schoolA,
        CLASS_A,
        CLASS_B,
        SUBJECT_MATH,
        SUBJECT_FR,
        TEACHER_ID,
        SAME_TS,
        LATER_TS,
      ],
    );

    const cold = await sync(adminPrincipal());
    assert.equal(cold.httpStatus, 200, "Admin school-wide 200");
    assert.equal(cold.body.mode, "full");
    assert.equal(cold.body.resource, "school-courses");
    const coldIds = cold.body.items.map((item) => item.id).sort();
    assert.deepEqual(coldIds, [COURSE_MATH, COURSE_FR, COURSE_B_MATH, COURSE_ARCHIVED].sort());
    const archived = cold.body.items.find((item) => item.id === COURSE_ARCHIVED);
    assert.equal(archived.tombstone, true);
    assert.equal(archived.status, "archived");
    assert.ok(!cold.body.items.some((item) => item.classCode === "CRS-CLS-B-ONLY"));

    await pool.query("SET enable_seqscan = off");
    const schoolPlan = JSON.stringify(
      (
        await pool.query(
          `EXPLAIN (FORMAT JSON)
           SELECT sc.id FROM school_courses sc
           WHERE sc.school_id = $1
           ORDER BY sc.updated_at ASC, sc.id ASC
           LIMIT 50`,
          [ids.schoolA],
        )
      ).rows,
    );
    assert.match(schoolPlan, /idx_school_courses_school_updated_at_id/, "index school-wide keyset");
    await pool.query("SET enable_seqscan = on");
    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'school_courses' AND indexname = 'idx_school_courses_school_updated_at_id'`,
    );
    assert.equal(indexes.rowCount, 1);

    const teacher = await sync(teacherPrincipal());
    assert.deepEqual(
      teacher.body.items.map((item) => item.courseCode).sort(),
      ["CRS-A-MATH", "CRS-A-OLD"].sort(),
    );
    assert.ok(!teacher.body.items.some((item) => item.courseCode === "CRS-A-FR"));
    assert.ok(!teacher.body.items.some((item) => item.courseCode === "CRS-B-MATH"));
    const teacherTombstone = teacher.body.items.find((item) => item.id === COURSE_ARCHIVED);
    assert.equal(teacherTombstone?.tombstone, true);

    const COURSE_NEW = "dddddddd-dddd-4ddd-8ddd-dddddddddd0e";
    await pool.query(
      `INSERT INTO school_courses (
         id, school_id, class_id, subject_id, teacher_id, course_code, coefficient, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'CRS-A-MATH-2', 2, 'active', $6::timestamptz)`,
      [COURSE_NEW, ids.schoolA, CLASS_B, SUBJECT_FR, TEACHER_ID, "2026-08-26T10:00:00.000Z"],
    );
    const delta = await sync(adminPrincipal(), { cursor: cold.body.nextCursor });
    assert.equal(delta.body.mode, "delta");
    assert.ok(delta.body.items.some((item) => item.id === COURSE_NEW));

    const page1 = await sync(adminPrincipal(), { limit: 2 });
    assert.equal(page1.body.hasMore, true);
    assert.equal(page1.body.items.length, 2);
    const page2 = await sync(adminPrincipal(), { cursor: page1.body.nextCursor, limit: 10 });
    const allIds = [...page1.body.items, ...page2.body.items].map((item) => item.id);
    assert.equal(new Set(allIds).size, allIds.length, "pagination sans doublon");

    await pool.query(
      `INSERT INTO school_courses (
         id, school_id, class_id, subject_id, teacher_id, course_code, status, updated_at
       ) VALUES
         ($1, $3, $4, $6, $8, 'CRS-X-CLASS', 'active', NOW()),
         ($2, $3, $5, $7, $8, 'CRS-X-SUB', 'active', NOW())`,
      [
        COURSE_CROSS_CLASS,
        COURSE_CROSS_SUBJECT,
        ids.schoolA,
        CLASS_B_ONLY,
        CLASS_A,
        SUBJECT_MATH,
        SUBJECT_B,
        TEACHER_ID,
      ],
    );
    await pool.query(`UPDATE school_courses SET teacher_id = $1 WHERE id = $2`, [
      TEACHER_B_ID,
      COURSE_B_MATH,
    ]);
    const leaks = await sync(adminPrincipal());
    assert.ok(!leaks.body.items.some((item) => item.id === COURSE_CROSS_CLASS));
    assert.ok(!leaks.body.items.some((item) => item.id === COURSE_CROSS_SUBJECT));
    const crossTeacher = leaks.body.items.find((item) => item.id === COURSE_B_MATH);
    assert.ok(crossTeacher, "cours A / teacher B reste listé sans donnée B");
    assert.equal(crossTeacher.teacherId, null);
    assert.equal(crossTeacher.teacherCode, null);
    assert.ok(!JSON.stringify(leaks.body.items).includes(TEACHER_B_ID));
    assert.ok(!JSON.stringify(leaks.body.items).includes("TCH-CRS-B"));
    assert.ok(!leaks.body.items.some((item) => item.classCode === "CRS-CLS-B-ONLY"));
    assert.ok(!leaks.body.items.some((item) => item.subjectCode === "SUB-CRS-B"));

    await pool.query(`UPDATE classes SET academic_year_id = $1 WHERE id = $2`, [ids.yearB, CLASS_B]);
    const yearLeak = await sync(adminPrincipal());
    assert.ok(!yearLeak.body.items.some((item) => item.academicYearId === ids.yearB));
    assert.ok(!yearLeak.body.items.some((item) => item.id === COURSE_B_MATH));
    await pool.query(`UPDATE classes SET academic_year_id = $1 WHERE id = $2`, [ids.yearA, CLASS_B]);

    await pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES ($1, $2, $3, 'TCH-CRS-ORPHAN', 'active')`,
      [TEACHER_ORPHAN_ID, ids.schoolA, TEACHER_B_USER_ID],
    );
    await pool.query(`UPDATE school_courses SET teacher_id = $1 WHERE id = $2`, [
      TEACHER_ORPHAN_ID,
      COURSE_FR,
    ]);
    const userLeak = await sync(adminPrincipal());
    const orphan = userLeak.body.items.find((item) => item.id === COURSE_FR);
    assert.ok(orphan);
    assert.equal(orphan.teacherId, TEACHER_ORPHAN_ID);
    assert.ok(!JSON.stringify(userLeak.body.items).includes(TEACHER_B_USER_ID));
    assert.ok(!JSON.stringify(userLeak.body.items).toLowerCase().includes("benoit"));

    failLiveRoles = true;
    const liveFail = await sync(adminPrincipal());
    assert.equal(liveFail.httpStatus, 503);
    assert.equal(liveFail.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);

    console.log("mobileSyncSchoolCourses.pg.test.js: OK school-wide/teacher-pairs/tombstone/tenant/EXPLAIN");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
