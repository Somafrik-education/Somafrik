"use strict";

/**
 * Vérifier PostgreSQL réel — GET /api/mobile-sync/l1/assignments.
 * Prérequis : DATABASE_URL (CI). Base isolée, aucun secret en dur.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createTeacherAssignmentsRepository } = require("../db/teacherAssignmentsRepository");
const { TokenService } = require("../services/tokenService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { handleMobileSyncL1Assignments } = require("./mobileSyncAssignments");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_MOBILE_SYNC_L1_ASSIGNMENTS_IT_DATABASE ?? "somafrik_mobile_sync_l1_assignments_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const CLASS_A = "aaaa1111-1111-4111-8111-111111111111";
const CLASS_B = "aaaa2222-2222-4222-8222-222222222222";
const CLASS_C = "aaaa3333-3333-4333-8333-333333333333";
const CLASS_B_ONLY = "aaaa5555-5555-4555-8555-555555555555";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEACHER_B_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0b";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEACHER_B_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccbb";
const SUBJECT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0b";
const ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd0a";
const ASSIGN_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd0b";
const ASSIGN_C = "dddddddd-dddd-4ddd-8ddd-dddddddddd0c";
const ASSIGN_CROSS_CLASS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const ASSIGN_CROSS_TEACHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const ASSIGN_CROSS_SUBJECT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const ASSIGN_CROSS_YEAR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04";
const ASSIGN_CROSS_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05";
const ASSIGN_ACTIF = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06";
const TEACHER_ORPHAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc0d";
const SAME_TS = "2026-08-26T08:00:00.000Z";
const LATER_TS = "2026-08-26T09:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_ASSIGNMENTS_IT_DATABASE invalide.");
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
    CREATE INDEX IF NOT EXISTS idx_teacher_assignments_school_updated_at_id
      ON teacher_assignments (school_id, updated_at, id);
    CREATE INDEX IF NOT EXISTS idx_teacher_assignments_school_teacher_updated_at_id
      ON teacher_assignments (school_id, teacher_id, updated_at, id);
  `);
  await pool.query(
    "TRUNCATE teacher_assignments, teachers, user_roles, users, subjects, classes, academic_years, schools, countries CASCADE",
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
  return { schoolA: schoolA.id, schoolB: schoolB.id, yearA: yearA.id, yearB: yearB.id };
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

function adminPrincipal(overrides = {}) {
  return {
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Affectations:READ"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: TEACHER_USER_ID,
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    schoolCode: "SCH-A",
    permissions: ["Affectations:READ"],
    teacherCode: "JWT-CODE",
    teacherId: "JWT-CODE",
    ...overrides,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncAssignments.pg.test.js: DATABASE_URL absent");
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
    const liveRoleKeysByUser = new Map([
      ["admin-1", ["SCHOOL_ADMIN"]],
      [TEACHER_USER_ID, ["TEACHER"]],
    ]);
    let failLiveRoles = false;
    const repository = {
      getSchoolByCode: (code) => adapter.getSchoolByCode(code),
      listSchoolTeacherAssignmentsForMobileSync: (code, options) =>
        assignmentsRepo.listForMobileSync(code, options),
      listSchoolTeacherAssignments: (code, options) => assignmentsRepo.listBySchoolCode(code, options),
      getLiveTeacherIdentityForSchool: (userId, schoolId) =>
        assignmentsRepo.getLiveTeacherIdentityForSchool(userId, schoolId),
      listLiveTeacherAssignmentIdsForSync: (schoolId, teacherId) =>
        assignmentsRepo.listLiveTeacherAssignmentIdsForSync(schoolId, teacherId),
      async listActiveUserRoleKeys() {
        throw new Error("listActiveUserRoleKeys unscoped ne doit pas être appelé par mobile-sync");
      },
      async listActiveUserRoleKeysForSchool(userId, schoolId) {
        if (failLiveRoles) throw new Error("pg roles unavailable");
        const uid = String(userId ?? "").trim();
        const sid = String(schoolId ?? "").trim();
        if (!uid || !sid) return [];
        if (liveRoleKeysByUser.has(uid)) return liveRoleKeysByUser.get(uid) ?? [];
        const rows = await pool.query(
          `SELECT role_key FROM user_roles
           WHERE user_id::text = $1 AND school_id::text = $2
             AND status = 'active' AND revoked_at IS NULL
           ORDER BY granted_at ASC`,
          [uid, sid],
        );
        return rows.rows.map((row) => row.role_key);
      },
      async resolveEffectivePermissions(principal) {
        const keys = new Set(principal.roleKeys ?? []);
        if (keys.has("SCHOOL_ADMIN") || keys.has("TEACHER") || keys.has("CUSTOM_ROLE")) {
          return { permissions: ["Affectations:READ"] };
        }
        return { permissions: [] };
      },
    };

    async function sync(principal, { cursor, limit } = {}) {
      return handleMobileSyncL1Assignments({
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
         ($1, $5, $7, 'CLS-A', '6ème A', 'active', $9::timestamptz),
         ($2, $5, $7, 'CLS-B', '6ème B', 'active', $9::timestamptz),
         ($3, $5, $7, 'CLS-C', '6ème C', 'active', $9::timestamptz),
         ($4, $6, $8, 'CLS-B-ONLY', '5ème B', 'active', $9::timestamptz)`,
      [CLASS_A, CLASS_B, CLASS_C, CLASS_B_ONLY, ids.schoolA, ids.schoolB, ids.yearA, ids.yearB, SAME_TS],
    );
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
       VALUES
         ($1, $3, 'TEACH-ASG-1', 'Tana', 'Kabila', 'Enseignant', 'active'),
         ($2, $4, 'TEACH-ASG-B', 'Benoit', 'Kanza', 'Enseignant', 'active')`,
      [TEACHER_USER_ID, TEACHER_B_USER_ID, ids.schoolA, ids.schoolB],
    );
    await pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES
         ($1, $3, $5, 'TCH-ASG-1', 'active'),
         ($2, $4, $6, 'TCH-ASG-B', 'active')`,
      [TEACHER_ID, TEACHER_B_ID, ids.schoolA, ids.schoolB, TEACHER_USER_ID, TEACHER_B_USER_ID],
    );
    await pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES
         ($1, $3, 'SUB-ASG-1', 'Maths', 'active'),
         ($2, $4, 'SUB-ASG-B', 'Physique', 'active')`,
      [SUBJECT_A, SUBJECT_B, ids.schoolA, ids.schoolB],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       )
       VALUES
         ($1, $7, $8, $4, $10, $11, 'active', $12::timestamptz),
         ($2, $7, $9, $5, $10, $11, 'active', $12::timestamptz),
         ($3, $7, $8, $6, $10, $11, 'active', $12::timestamptz)`,
      [
        ASSIGN_A,
        ASSIGN_B,
        ASSIGN_C,
        CLASS_A,
        CLASS_B,
        CLASS_C,
        ids.schoolA,
        TEACHER_ID,
        TEACHER_B_ID,
        SUBJECT_A,
        ids.yearA,
        SAME_TS,
      ],
    );

    // CAS 1 — Admin school-wide full : A et C visibles, B (teacher B) masqué, zéro fuite B-only
    const cold = await sync(adminPrincipal());
    assert.equal(cold.httpStatus, 200, "CAS1 status");
    assert.equal(cold.body.mode, "full");
    assert.deepEqual(
      cold.body.items.map((item) => item.id).sort(),
      [ASSIGN_A, ASSIGN_C],
    );
    assert.ok(!cold.body.items.some((item) => item.classCode === "CLS-B-ONLY"));
    assert.ok(!cold.body.items.some((item) => item.teacherCode === "TCH-ASG-B"));
    assert.ok(!cold.body.items.some((item) => item.subjectCode === "SUB-ASG-B"));
    for (const item of cold.body.items) {
      assert.equal(item.teacherId, TEACHER_ID);
      assert.notEqual(item.teacherId, item.teacherCode);
      assert.equal(item.teacherUserId, TEACHER_USER_ID);
      assert.equal(item.tombstone, false);
    }

    await pool.query("SET enable_seqscan = off");
    const explainedSchool = await pool.query(
      `EXPLAIN (FORMAT JSON)
       SELECT ta.id FROM teacher_assignments ta
       WHERE ta.school_id = $1
         AND (ta.updated_at > $2::timestamptz OR (ta.updated_at = $2::timestamptz AND ta.id > $3::uuid))
       ORDER BY ta.updated_at ASC, ta.id ASC`,
      [ids.schoolA, SAME_TS, ASSIGN_A],
    );
    const explainedAssigned = await pool.query(
      `EXPLAIN (FORMAT JSON)
       SELECT ta.id FROM teacher_assignments ta
       WHERE ta.school_id = $1 AND ta.teacher_id = $2
         AND (ta.updated_at > $3::timestamptz OR (ta.updated_at = $3::timestamptz AND ta.id > $4::uuid))
       ORDER BY ta.updated_at ASC, ta.id ASC`,
      [ids.schoolA, TEACHER_ID, SAME_TS, ASSIGN_A],
    );
    await pool.query("SET enable_seqscan = on");
    const schoolPlan = JSON.stringify(explainedSchool.rows[0]);
    const assignedPlan = JSON.stringify(explainedAssigned.rows[0]);
    assert.match(schoolPlan, /idx_teacher_assignments_school_/, "index school-wide keyset (seqscan off)");
    assert.match(
      assignedPlan,
      /idx_teacher_assignments_school_teacher_updated_at_id|idx_teacher_assignments_school_updated_at_id/,
      "index assigned keyset",
    );
    const indexNames = (
      await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'teacher_assignments'
           AND indexname LIKE 'idx_teacher_assignments_school%'
         ORDER BY indexname`,
      )
    ).rows.map((row) => row.indexname);
    assert.ok(indexNames.includes("idx_teacher_assignments_school_updated_at_id"));
    assert.ok(indexNames.includes("idx_teacher_assignments_school_teacher_updated_at_id"));

    // CAS 5 — pagination timestamps identiques
    const page1 = await sync(adminPrincipal(), { limit: 1 });
    assert.equal(page1.body.items.length, 1);
    assert.equal(page1.body.hasMore, true);
    const page2 = await sync(adminPrincipal(), { cursor: page1.body.nextCursor, limit: 1 });
    assert.equal(page2.body.mode, "delta");
    const seen = new Set([...page1.body.items, ...page2.body.items].map((item) => item.id));
    assert.equal(seen.size, 2);

    // CAS 2 — création → delta
    const ASSIGN_D = "dddddddd-dddd-4ddd-8ddd-dddddddddd0d";
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::timestamptz)`,
      [ASSIGN_D, ids.schoolA, TEACHER_ID, CLASS_A, SUBJECT_A, ids.yearA, LATER_TS],
    );
    const created = await sync(adminPrincipal(), { cursor: cold.body.nextCursor });
    assert.equal(created.body.mode, "delta");
    assert.ok(created.body.items.some((item) => item.id === ASSIGN_D));

    // CAS 3 — modification classe/matière → delta
    await pool.query(
      `UPDATE teacher_assignments SET class_id = $1, updated_at = $3::timestamptz WHERE id = $2`,
      [CLASS_C, ASSIGN_D, "2026-08-26T10:00:00.000Z"],
    );
    const updated = await sync(adminPrincipal(), { cursor: created.body.nextCursor });
    assert.equal(updated.body.mode, "delta");
    assert.equal(updated.body.items[0].id, ASSIGN_D);
    assert.equal(updated.body.items[0].classCode, "CLS-C");

    // CAS 4 — suppression → tombstone school-wide
    await pool.query(
      `UPDATE teacher_assignments SET status = 'deleted', updated_at = $2::timestamptz WHERE id = $1`,
      [ASSIGN_D, "2026-08-26T11:00:00.000Z"],
    );
    const deleted = await sync(adminPrincipal(), { cursor: updated.body.nextCursor });
    assert.equal(deleted.body.mode, "delta");
    assert.equal(deleted.body.items[0].id, ASSIGN_D);
    assert.equal(deleted.body.items[0].status, "deleted");
    assert.equal(deleted.body.items[0].tombstone, true);

    // CAS 6 — Teacher uniquement ses affectations actives
    const teacher = await sync(teacherPrincipal());
    assert.deepEqual(
      teacher.body.items.map((item) => item.id).sort(),
      [ASSIGN_A, ASSIGN_C],
    );
    assert.ok(teacher.body.items.every((item) => item.teacherId === TEACHER_ID));
    assert.ok(!teacher.body.items.some((item) => item.tombstone));

    // GET historique vs L1 : même périmètre actif
    const historical = await assignmentsRepo.listBySchoolCode("SCH-A", { teacherId: TEACHER_ID });
    assert.deepEqual(
      historical.map((row) => row.id).sort(),
      teacher.body.items.map((item) => item.id).sort(),
    );

    // CAS 9 — grant → scope_changed
    const ASSIGN_GRANT = "dddddddd-dddd-4ddd-8ddd-dddddddddd0e";
    const teacherCold = await sync(teacherPrincipal());
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'secondary', 'active', NOW())`,
      [ASSIGN_GRANT, ids.schoolA, TEACHER_ID, CLASS_B, SUBJECT_A, ids.yearA],
    );
    const granted = await sync(teacherPrincipal(), { cursor: teacherCold.body.nextCursor });
    assert.equal(granted.httpStatus, 409);
    assert.equal(granted.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);

    const afterGrantFull = await sync(teacherPrincipal());
    assert.ok(afterGrantFull.body.items.some((item) => item.id === ASSIGN_GRANT));

    // CAS 10 — revoke → scope_changed, full sans la ligne
    await pool.query(`UPDATE teacher_assignments SET status = 'deleted', updated_at = NOW() WHERE id = $1`, [
      ASSIGN_GRANT,
    ]);
    const revoked = await sync(teacherPrincipal(), { cursor: afterGrantFull.body.nextCursor });
    assert.equal(revoked.httpStatus, 409);
    const resync = await sync(teacherPrincipal());
    assert.ok(!resync.body.items.some((item) => item.id === ASSIGN_GRANT));

    // CAS 15 — classe B référencée par assignment A corrompu → aucune fuite
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())`,
      [ASSIGN_CROSS_CLASS, ids.schoolA, TEACHER_ID, CLASS_B_ONLY, SUBJECT_A, ids.yearA],
    );
    const crossClass = await sync(adminPrincipal());
    assert.ok(!crossClass.body.items.some((item) => item.id === ASSIGN_CROSS_CLASS));
    assert.ok(!crossClass.body.items.some((item) => item.classCode === "CLS-B-ONLY"));
    assert.ok(!crossClass.body.items.some((item) => item.classId === CLASS_B_ONLY));

    // CAS 16 — teacher B référencé par assignment A
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'cross-teacher', 'active', NOW())`,
      [ASSIGN_CROSS_TEACHER, ids.schoolA, TEACHER_B_ID, CLASS_A, SUBJECT_A, ids.yearA],
    );
    const crossTeacher = await sync(adminPrincipal());
    assert.ok(!crossTeacher.body.items.some((item) => item.id === ASSIGN_CROSS_TEACHER));
    assert.ok(!crossTeacher.body.items.some((item) => item.teacherCode === "TCH-ASG-B"));
    assert.ok(!crossTeacher.body.items.some((item) => item.teacherId === TEACHER_B_ID));

    // CAS 17 — subject B
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'cross-subject', 'active', NOW())`,
      [ASSIGN_CROSS_SUBJECT, ids.schoolA, TEACHER_ID, CLASS_A, SUBJECT_B, ids.yearA],
    );
    const crossSubject = await sync(adminPrincipal());
    assert.ok(!crossSubject.body.items.some((item) => item.id === ASSIGN_CROSS_SUBJECT));
    assert.ok(!crossSubject.body.items.some((item) => item.subjectCode === "SUB-ASG-B"));
    assert.ok(!crossSubject.body.items.some((item) => item.subjectId === SUBJECT_B));

    // année B référencée par assignment A
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'cross-year', 'active', NOW())`,
      [ASSIGN_CROSS_YEAR, ids.schoolA, TEACHER_ID, CLASS_A, SUBJECT_A, ids.yearB],
    );
    const crossYear = await sync(adminPrincipal());
    assert.ok(!crossYear.body.items.some((item) => item.id === ASSIGN_CROSS_YEAR));
    assert.ok(!crossYear.body.items.some((item) => item.academicYearId === ids.yearB));

    // teacher A → user B : assignment visible, teacherUserId null, zéro UUID B
    await pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES ($1, $2, $3, 'TCH-ASG-ORPHAN', 'active')`,
      [TEACHER_ORPHAN_ID, ids.schoolA, TEACHER_B_USER_ID],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'cross-user', 'active', NOW())`,
      [ASSIGN_CROSS_USER, ids.schoolA, TEACHER_ORPHAN_ID, CLASS_A, SUBJECT_A, ids.yearA],
    );
    const crossUser = await sync(adminPrincipal());
    const orphan = crossUser.body.items.find((item) => item.id === ASSIGN_CROSS_USER);
    assert.ok(orphan, "assignment teacher A / user B reste listé");
    assert.equal(orphan.teacherUserId, null);
    assert.equal(orphan.teacherId, TEACHER_ORPHAN_ID);
    assert.ok(!JSON.stringify(crossUser.body.items).includes(TEACHER_B_USER_ID));

    const historicalLeaks = await assignmentsRepo.listBySchoolCode("SCH-A");
    assert.ok(!historicalLeaks.some((row) => row.id === ASSIGN_CROSS_CLASS));
    assert.ok(!historicalLeaks.some((row) => row.id === ASSIGN_CROSS_TEACHER));
    assert.ok(!historicalLeaks.some((row) => row.id === ASSIGN_CROSS_SUBJECT));
    assert.ok(!historicalLeaks.some((row) => row.id === ASSIGN_CROSS_YEAR));
    assert.ok(!historicalLeaks.some((row) => row.classCode === "CLS-B-ONLY"));
    assert.ok(!historicalLeaks.some((row) => row.teacherCode === "TCH-ASG-B" || row.teacherId === "TCH-ASG-B"));
    assert.ok(!historicalLeaks.some((row) => row.subjectCode === "SUB-ASG-B"));
    assert.ok(!JSON.stringify(historicalLeaks).includes(TEACHER_B_USER_ID));
    assert.ok(!JSON.stringify(historicalLeaks).toLowerCase().includes("benoit"));
    const historicalOrphan = historicalLeaks.find((row) => row.id === ASSIGN_CROSS_USER);
    assert.ok(historicalOrphan);
    assert.equal(String(historicalOrphan.teacherName ?? "").trim(), "");

    // statut actif canonique : `actif` visible et non-tombstone
    await pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'actif', NOW())`,
      [ASSIGN_ACTIF, ids.schoolA, TEACHER_ID, CLASS_A, SUBJECT_A, ids.yearA],
    );
    const actifL1 = await sync(adminPrincipal());
    const actifItem = actifL1.body.items.find((item) => item.id === ASSIGN_ACTIF);
    assert.ok(actifItem);
    assert.equal(actifItem.status, "actif");
    assert.equal(actifItem.tombstone, false);
    const actifHist = await assignmentsRepo.listBySchoolCode("SCH-A");
    assert.ok(actifHist.some((row) => row.id === ASSIGN_ACTIF && row.status === "actif"));

    failLiveRoles = true;
    const liveFail = await sync(adminPrincipal());
    assert.equal(liveFail.httpStatus, 503);
    assert.equal(liveFail.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
    failLiveRoles = false;

    console.log("mobileSyncAssignments.pg.test.js: OK school-wide/delta/tombstone/teacher/tenant-joins/EXPLAIN");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
