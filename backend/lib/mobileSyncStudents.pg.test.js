"use strict";

/**
 * Vérifier PostgreSQL réel — GET /api/mobile-sync/l1/students.
 * Prérequis : DATABASE_URL (CI). Base isolée.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createClassesRepository } = require("../db/classesRepository");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");
const { TokenService } = require("../services/tokenService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { handleMobileSyncL1Students } = require("./mobileSyncStudents");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");
const { PERMISSION_DENIED } = require("../services/rbacService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_MOBILE_SYNC_L1_STUDENTS_IT_DATABASE ?? "somafrik_mobile_sync_l1_students_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const CLASS_C = "33333333-3333-4333-8333-333333333333";
const CLASS_B_ONLY = "44444444-4444-4444-8444-444444444444";
const STU_A = "55555555-5555-4555-8555-555555555551";
const STU_B = "55555555-5555-4555-8555-555555555552";
const STU_C = "55555555-5555-4555-8555-555555555553";
const STU_D = "55555555-5555-4555-8555-555555555554";
const STU_B_ONLY = "55555555-5555-4555-8555-555555555559";
const ENR_A = "66666666-6666-4666-8666-666666666661";
const ENR_B = "66666666-6666-4666-8666-666666666662";
const ENR_C = "66666666-6666-4666-8666-666666666663";
const ENR_D = "66666666-6666-4666-8666-666666666664";
const ENR_B_ONLY = "66666666-6666-4666-8666-666666666669";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARENT_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa30";
const STUDENT_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa40";
const DUAL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10";
const SUBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTACT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddd20";
const RELATION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee20";
const ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASSIGN_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd11";
const SAME_TS = "2026-08-26T08:00:00.000Z";
const LATER_TS = "2026-08-26T09:00:00.000Z";
const LATER2_TS = "2026-08-26T10:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_STUDENTS_IT_DATABASE invalide.");
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
    CREATE TABLE IF NOT EXISTS user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      school_id UUID REFERENCES schools(id),
      role_key TEXT NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_code VARCHAR(64) NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_id UUID NOT NULL REFERENCES students(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      enrollment_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      country_id UUID NOT NULL REFERENCES countries(id),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      contact_type TEXT NOT NULL DEFAULT 'parent',
      status TEXT NOT NULL DEFAULT 'active',
      user_id UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS contact_relations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      country_id UUID NOT NULL REFERENCES countries(id),
      relation_type TEXT NOT NULL DEFAULT 'parent_student',
      contact_id UUID NOT NULL REFERENCES contacts(id),
      student_id UUID NOT NULL REFERENCES students(id),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);
    CREATE INDEX IF NOT EXISTS idx_enrollments_school_student_updated_at
      ON enrollments (school_id, student_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_enrollments_school_class_status_student
      ON enrollments (school_id, class_id, status, student_id);
    CREATE INDEX IF NOT EXISTS idx_contact_relations_school_contact_status_student
      ON contact_relations (school_id, contact_id, status, student_id);
  `);
  await pool.query(`
    TRUNCATE contact_relations, contacts, enrollments, students, teacher_assignments,
             teachers, user_roles, users, subjects, classes, academic_years, schools, countries CASCADE
  `);

  const country = await pool.query(
    `INSERT INTO countries (name, iso_code) VALUES ('Testland', 'TT') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name)
     VALUES ($1, 'SCH-A', 'École A'), ($1, 'SCH-B', 'École B')`,
    [country.rows[0].id],
  );
  await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     SELECT id, '2025-2026', 'open' FROM schools WHERE school_code IN ('SCH-A', 'SCH-B')`,
  );

  const schoolA = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-A'`)).rows[0];
  const schoolB = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-B'`)).rows[0];
  const yearA = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-A'`,
    )
  ).rows[0];
  const yearB = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-B'`,
    )
  ).rows[0];
  return {
    countryId: country.rows[0].id,
    schoolA: schoolA.id,
    schoolB: schoolB.id,
    yearA: yearA.id,
    yearB: yearB.id,
  };
}

function createDbAdapter(pool) {
  return {
    async one(sql, params = []) {
      return (await pool.query(sql, params)).rows[0] ?? null;
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

async function insertClass(pool, { id, schoolId, yearId, classCode, name, updatedAt }) {
  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6::timestamptz)`,
    [id, schoolId, yearId, classCode, name, updatedAt],
  );
}

async function insertStudent(pool, { id, schoolId, studentCode, firstName, lastName = "Test", status = "active", updatedAt }) {
  await pool.query(
    `INSERT INTO students (id, school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [id, schoolId, studentCode, firstName, lastName, status, updatedAt],
  );
}

async function insertEnrollment(pool, { id, schoolId, studentId, classId, yearId, status = "active", updatedAt }) {
  await pool.query(
    `INSERT INTO enrollments (id, school_id, student_id, class_id, academic_year_id, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [id, schoolId, studentId, classId, yearId, status, updatedAt],
  );
}

function adminPrincipal(overrides = {}) {
  return {
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ", "Gérer élèves"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: TEACHER_USER_ID,
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ"],
    assignments: [
      { classId: CLASS_A, classCode: "CLS-A", status: "active" },
      { classId: CLASS_B, classCode: "CLS-B", status: "active" },
    ],
    ...overrides,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncStudents.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
  const tenantScopeService = new TenantScopeService();

  try {
    const ids = await setupFixture(pool);
    const adapter = createDbAdapter(pool);
    const classesRepo = createClassesRepository(adapter);
    const studentsRepo = createClassStudentsRepository(adapter);
    const liveRoleKeysByUser = new Map([
      ["admin-1", ["SCHOOL_ADMIN"]],
      [TEACHER_USER_ID, ["TEACHER"]],
      [PARENT_USER_ID, ["PARENT"]],
      [STUDENT_USER_ID, ["STUDENT"]],
    ]);
    let failLiveRoles = false;
    let studentSqlCalls = 0;
    const repository = {
      getSchoolByCode: (code) => adapter.getSchoolByCode(code),
      listSchoolStudentsForMobileSync: (code, options) => {
        studentSqlCalls += 1;
        return studentsRepo.listForMobileSync(code, options);
      },
      listLiveTeacherClassAssignmentsForSync: (userId, schoolId) =>
        classesRepo.listLiveTeacherClassAssignmentsForSync(userId, schoolId),
      listLiveAssignedStudentIdsForSync: (schoolId, refs) =>
        studentsRepo.listLiveAssignedStudentIdsForSync(schoolId, refs),
      listLiveParentLinkedStudentIdsForSync: (userId, schoolId) =>
        studentsRepo.listLiveParentLinkedStudentIdsForSync(userId, schoolId),
      listLiveSelfStudentIdForSync: (userId, schoolId) =>
        studentsRepo.listLiveSelfStudentIdForSync(userId, schoolId),
      async listActiveUserRoleKeys() {
        throw new Error("listActiveUserRoleKeys unscoped ne doit pas être appelé par mobile-sync");
      },
      async listActiveUserRoleKeysForSchool(userId, schoolId) {
        if (failLiveRoles) throw new Error("pg roles unavailable");
        const uid = String(userId ?? "").trim();
        const sid = String(schoolId ?? "").trim();
        if (!uid || !sid) return [];
        if (liveRoleKeysByUser.has(uid)) {
          return liveRoleKeysByUser.get(uid) ?? [];
        }
        const rows = await pool.query(
          `SELECT role_key
           FROM user_roles
           WHERE user_id::text = $1
             AND school_id::text = $2
             AND status = 'active'
             AND revoked_at IS NULL
           ORDER BY granted_at ASC`,
          [uid, sid],
        );
        return rows.rows.map((row) => row.role_key);
      },
      async resolveEffectivePermissions(principal) {
        const keys = new Set(principal.roleKeys ?? []);
        if (keys.has("SCHOOL_ADMIN")) {
          return { permissions: ["Élèves:READ", "Gérer élèves"] };
        }
        if (keys.has("TEACHER") || keys.has("PARENT") || keys.has("STUDENT")) {
          return { permissions: ["Élèves:READ"] };
        }
        return { permissions: [] };
      },
    };

    async function sync(principal, { cursor, limit } = {}) {
      return handleMobileSyncL1Students({
        principal,
        cursor,
        limit,
        tokenService: tokens,
        repository,
        tenantScopeService,
      });
    }

    await insertClass(pool, {
      id: CLASS_A,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classCode: "CLS-A",
      name: "6ème A",
      updatedAt: SAME_TS,
    });
    await insertClass(pool, {
      id: CLASS_B,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classCode: "CLS-B",
      name: "6ème B",
      updatedAt: SAME_TS,
    });
    await insertClass(pool, {
      id: CLASS_C,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classCode: "CLS-C",
      name: "6ème C",
      updatedAt: SAME_TS,
    });
    await insertClass(pool, {
      id: CLASS_B_ONLY,
      schoolId: ids.schoolB,
      yearId: ids.yearB,
      classCode: "CLS-B-ONLY",
      name: "5ème B",
      updatedAt: SAME_TS,
    });

    await insertStudent(pool, {
      id: STU_A,
      schoolId: ids.schoolA,
      studentCode: "STU-A",
      firstName: "Ada",
      updatedAt: SAME_TS,
    });
    await insertStudent(pool, {
      id: STU_B,
      schoolId: ids.schoolA,
      studentCode: "STU-B",
      firstName: "Binta",
      updatedAt: SAME_TS,
    });
    await insertStudent(pool, {
      id: STU_C,
      schoolId: ids.schoolA,
      studentCode: "STU-C",
      firstName: "Cira",
      updatedAt: SAME_TS,
    });
    await insertStudent(pool, {
      id: STU_B_ONLY,
      schoolId: ids.schoolB,
      studentCode: "STU-B-ONLY",
      firstName: "BintaB",
      updatedAt: SAME_TS,
    });

    await insertEnrollment(pool, {
      id: ENR_A,
      schoolId: ids.schoolA,
      studentId: STU_A,
      classId: CLASS_A,
      yearId: ids.yearA,
      updatedAt: SAME_TS,
    });
    await insertEnrollment(pool, {
      id: ENR_B,
      schoolId: ids.schoolA,
      studentId: STU_B,
      classId: CLASS_B,
      yearId: ids.yearA,
      updatedAt: SAME_TS,
    });
    await insertEnrollment(pool, {
      id: ENR_C,
      schoolId: ids.schoolA,
      studentId: STU_C,
      classId: CLASS_A,
      yearId: ids.yearA,
      updatedAt: SAME_TS,
    });
    await insertEnrollment(pool, {
      id: ENR_B_ONLY,
      schoolId: ids.schoolB,
      studentId: STU_B_ONLY,
      classId: CLASS_B_ONLY,
      yearId: ids.yearB,
      updatedAt: SAME_TS,
    });

    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
       VALUES
         ($1, $3, 'TEACH-STU-1', 'Tana', 'Kabila', 'Enseignant', 'active'),
         ($2, $3, 'PARENT-STU-1', 'Paula', 'Ngo', 'Parent', 'active'),
         ($4, $3, 'STU-A', 'Ada', 'Test', 'Élève / Étudiant', 'active'),
         ($5, $3, 'DUAL-STU-1', 'Dina', 'Mwamba', 'Enseignant', 'active')`,
      [TEACHER_USER_ID, PARENT_USER_ID, ids.schoolA, STUDENT_USER_ID, DUAL_USER_ID],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES
         ($1, $3, 'TEACHER', 'active'),
         ($2, $3, 'PARENT', 'active'),
         ($4, $3, 'STUDENT', 'active'),
         ($5, $3, 'TEACHER', 'active'),
         ($5, $6, 'SCHOOL_ADMIN', 'active')`,
      [TEACHER_USER_ID, PARENT_USER_ID, ids.schoolA, STUDENT_USER_ID, DUAL_USER_ID, ids.schoolB],
    );
    await pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES
         ($1, $2, $3, 'TCH-STU-1', 'active'),
         ($4, $2, $5, 'TCH-DUAL-STU-1', 'active')`,
      [TEACHER_ID, ids.schoolA, TEACHER_USER_ID, "cccccccc-cccc-4ccc-8ccc-cccccccccc10", DUAL_USER_ID],
    );
    await pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES ($1, $2, 'SUB-STU-1', 'Maths', 'active')`,
      [SUBJECT_ID, ids.schoolA],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status
       )
       VALUES
         ($1, $3, $4, $5, $7, $8, 'active'),
         ($2, $3, $6, $5, $7, $8, 'active')`,
      [
        ASSIGN_A,
        "dddddddd-dddd-4ddd-8ddd-dddddddddd10",
        ids.schoolA,
        TEACHER_ID,
        CLASS_A,
        "cccccccc-cccc-4ccc-8ccc-cccccccccc10",
        SUBJECT_ID,
        ids.yearA,
      ],
    );
    await pool.query(
      `INSERT INTO contacts (id, school_id, country_id, first_name, last_name, contact_type, status, user_id)
       VALUES ($1, $2, $3, 'Paula', 'Ngo', 'parent', 'active', $4)`,
      [CONTACT_ID, ids.schoolA, ids.countryId, PARENT_USER_ID],
    );
    await pool.query(
      `INSERT INTO contact_relations (
         id, school_id, country_id, contact_id, student_id, status
       )
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [RELATION_ID, ids.schoolA, ids.countryId, CONTACT_ID, STU_A],
    );

    const cold = await sync(adminPrincipal());
    assert.equal(cold.httpStatus, 200, "CAS1 status");
    assert.equal(cold.body.mode, "full");
    assert.equal(cold.body.resource, "students");
    assert.equal(cold.body.items.length, 3);
    assert.deepEqual(
      cold.body.items.map((item) => item.studentCode).sort(),
      ["STU-A", "STU-B", "STU-C"],
    );
    assert.ok(!cold.body.items.some((item) => item.studentCode === "STU-B-ONLY"));
    for (const item of cold.body.items) {
      assert.equal(item.tombstone, false);
      assert.equal(Object.hasOwn(item, "parentPhone"), false);
    }

    await pool.query("SET enable_seqscan = off");
    const explained = await pool.query(
      `EXPLAIN (FORMAT JSON)
       SELECT sync_rows.id
       FROM (
         SELECT st.id,
                GREATEST(st.updated_at, COALESCE(clk.max_updated_at, st.updated_at)) AS sync_updated_at
         FROM students st
         LEFT JOIN (
           SELECT student_id, MAX(updated_at) AS max_updated_at
           FROM enrollments
           WHERE school_id = $1
           GROUP BY student_id
         ) clk ON clk.student_id = st.id
         WHERE st.school_id = $1
       ) sync_rows
       WHERE (sync_rows.sync_updated_at > $2::timestamptz
          OR (sync_rows.sync_updated_at = $2::timestamptz AND sync_rows.id > $3::uuid))
       ORDER BY sync_rows.sync_updated_at ASC, sync_rows.id ASC`,
      [ids.schoolA, SAME_TS, STU_A],
    );
    await pool.query("SET enable_seqscan = on");
    const planText = JSON.stringify(explained.rows[0]);
    assert.match(
      planText,
      /idx_students_school_id|idx_enrollments_school_student_updated_at/,
      "index tenant/horloge utilisable (enable_seqscan=off)",
    );
    assert.doesNotMatch(planText, /Seq Scan on students/);

    const page1 = await sync(adminPrincipal(), { limit: 2 });
    assert.equal(page1.body.items.length, 2);
    assert.equal(page1.body.hasMore, true);
    const page2 = await sync(adminPrincipal(), { cursor: page1.body.nextCursor, limit: 2 });
    assert.equal(page2.body.mode, "delta");
    const seen = new Set([...page1.body.items, ...page2.body.items].map((item) => item.id));
    assert.equal(seen.size, 3);

    await pool.query(`UPDATE students SET first_name = 'Amina', updated_at = $2::timestamptz WHERE id = $1`, [
      STU_A,
      LATER_TS,
    ]);
    const identityDelta = await sync(adminPrincipal(), { cursor: cold.body.nextCursor });
    assert.equal(identityDelta.body.mode, "delta");
    assert.ok(identityDelta.body.items.some((item) => item.id === STU_A && item.firstName === "Amina"));

    await insertStudent(pool, {
      id: STU_D,
      schoolId: ids.schoolA,
      studentCode: "STU-D",
      firstName: "Demba",
      updatedAt: LATER2_TS,
    });
    await insertEnrollment(pool, {
      id: ENR_D,
      schoolId: ids.schoolA,
      studentId: STU_D,
      classId: CLASS_C,
      yearId: ids.yearA,
      updatedAt: LATER2_TS,
    });
    const created = await sync(adminPrincipal(), { cursor: identityDelta.body.nextCursor });
    assert.ok(created.body.items.some((item) => item.studentCode === "STU-D"));

    await pool.query(
      `UPDATE enrollments SET class_id = $2, updated_at = $3::timestamptz WHERE id = $1`,
      [ENR_B, CLASS_C, LATER2_TS],
    );
    const transferred = await sync(adminPrincipal(), { cursor: created.body.nextCursor });
    const transferredB = transferred.body.items.find((item) => item.id === STU_B);
    assert.ok(transferredB, "transfert school-wide visible en delta");
    assert.equal(transferredB.classId, CLASS_C);
    assert.equal(transferredB.classCode, "CLS-C");

    await pool.query(
      `UPDATE enrollments SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [ENR_D],
    );
    const deactivated = await sync(adminPrincipal(), { cursor: transferred.body.nextCursor });
    const dRow = deactivated.body.items.find((item) => item.id === STU_D);
    assert.ok(dRow, "inactivation inscription → delta");
    assert.equal(dRow.classId, null);
    assert.equal(dRow.classCode, null);
    assert.equal(dRow.tombstone, false);

    await pool.query(`UPDATE students SET status = 'inactive', updated_at = NOW() WHERE id = $1`, [STU_C]);
    const tombstoned = await sync(adminPrincipal(), { cursor: deactivated.body.nextCursor });
    assert.ok(
      tombstoned.body.items.some((item) => item.id === STU_C && item.tombstone === true && item.status === "inactive"),
    );

    const teacherCold = await sync(teacherPrincipal());
    assert.equal(teacherCold.httpStatus, 200);
    assert.ok(teacherCold.body.items.every((item) => item.classCode === "CLS-A"));
    assert.ok(!teacherCold.body.items.some((item) => item.id === STU_B));

    await pool.query(
      `UPDATE enrollments SET class_id = $2, status = 'active', updated_at = NOW() WHERE id = $1`,
      [ENR_B, CLASS_A],
    );
    const teacherAdded = await sync(teacherPrincipal(), { cursor: teacherCold.body.nextCursor });
    assert.equal(teacherAdded.httpStatus, 409);
    assert.equal(teacherAdded.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);

    const teacherAfterAdd = await sync(teacherPrincipal());
    assert.ok(teacherAfterAdd.body.items.some((item) => item.id === STU_B));

    await pool.query(
      `UPDATE enrollments SET class_id = $2, updated_at = NOW() WHERE id = $1`,
      [ENR_B, CLASS_B],
    );
    const teacherOut = await sync(teacherPrincipal(), { cursor: teacherAfterAdd.body.nextCursor });
    assert.equal(teacherOut.body.cursorStatus, "scope_changed");
    const teacherResync = await sync(teacherPrincipal());
    assert.ok(!teacherResync.body.items.some((item) => item.id === STU_B));

    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [ASSIGN_B, ids.schoolA, TEACHER_ID, CLASS_B, SUBJECT_ID, ids.yearA],
    );
    const teacherGrant = await sync(teacherPrincipal(), { cursor: teacherResync.body.nextCursor });
    assert.equal(teacherGrant.body.cursorStatus, "scope_changed");

    liveRoleKeysByUser.set(TEACHER_USER_ID, []);
    const teacherRevoked = await sync(teacherPrincipal());
    assert.equal(teacherRevoked.httpStatus, 200);
    assert.deepEqual(teacherRevoked.body.items, []);
    liveRoleKeysByUser.set(TEACHER_USER_ID, ["TEACHER"]);

    const dual = await sync({
      sub: DUAL_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Élèves:READ", "Gérer élèves"],
    });
    assert.equal(dual.httpStatus, 200);
    assert.ok(!dual.body.items.some((item) => item.studentCode === "STU-B-ONLY"));
    assert.ok(dual.body.items.every((item) => item.classCode === "CLS-A"));

    liveRoleKeysByUser.set("acc-1", ["ACCOUNTANT"]);
    const accountantResult = await sync({
      sub: "acc-1",
      role: "Admin School",
      schoolCode: "SCH-A",
      permissions: ["Élèves:READ", "Gérer élèves"],
    });
    assert.equal(accountantResult.httpStatus, 403);
    assert.equal(accountantResult.body.code, PERMISSION_DENIED);
    assert.equal(accountantResult.body.items, undefined);

    const parentPrincipal = {
      sub: PARENT_USER_ID,
      role: "Parent",
      schoolCode: "SCH-A",
      permissions: ["Élèves:READ"],
      studentIds: [STU_B],
    };
    const parentCold = await sync(parentPrincipal);
    assert.deepEqual(
      parentCold.body.items.map((item) => item.id),
      [STU_A],
    );
    await pool.query(`UPDATE contact_relations SET status = 'inactive', updated_at = NOW() WHERE id = $1`, [
      RELATION_ID,
    ]);
    const parentRevoked = await sync(parentPrincipal, { cursor: parentCold.body.nextCursor });
    assert.equal(parentRevoked.body.cursorStatus, "scope_changed");
    const parentResync = await sync(parentPrincipal);
    assert.deepEqual(parentResync.body.items, []);

    const selfPrincipal = {
      sub: STUDENT_USER_ID,
      role: "Élève / Étudiant",
      schoolCode: "SCH-A",
      permissions: ["Élèves:READ"],
      studentIds: [STU_B],
    };
    const selfSync = await sync(selfPrincipal);
    assert.deepEqual(
      selfSync.body.items.map((item) => item.id),
      [STU_A],
    );

    const classesCursor = encodeMobileSyncCursor(
      {
        resource: "classes",
        schoolCode: "SCH-A",
        schoolId: ids.schoolA,
        principalId: "admin-1",
        scopeHash: cold.body.scopeHash,
      },
      tokens,
    );
    await assert.rejects(
      () => sync(adminPrincipal(), { cursor: classesCursor }),
      (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
    );

    failLiveRoles = true;
    const liveFail = await sync(adminPrincipal());
    assert.equal(liveFail.httpStatus, 503);
    assert.equal(liveFail.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
    failLiveRoles = false;

    console.log("mobileSyncStudents.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
