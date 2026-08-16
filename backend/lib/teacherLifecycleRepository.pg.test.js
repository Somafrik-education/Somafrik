"use strict";

/**
 * Intégration PostgreSQL — cycle de vie enseignant (update / archive / audit réel).
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createTeachersRepository } = require("../db/teachersRepository");
const { createTeacherAssignmentsRepository } = require("../db/teacherAssignmentsRepository");
const { createTeacherLifecycleRepository } = require("../db/teacherLifecycleRepository");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureTeacherAssignmentsActiveUniqueness } = require("./teacherAssignmentsUniqueness");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const TEACHER_IT_DATABASE = String(
  process.env.SOMAFRIK_TEACHER_LIFECYCLE_IT_DATABASE ?? "somafrik_teacher_lifecycle_it",
)
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

function poolAdapter(pool) {
  return {
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    query: (sql, params) => pool.query(sql, params),
  };
}

async function setupFixture(pool) {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS countries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      iso_code VARCHAR(8) NOT NULL UNIQUE,
      phone_code VARCHAR(16) NOT NULL DEFAULT '+000',
      currency VARCHAR(16) NOT NULL DEFAULT 'XOF',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      school_code VARCHAR(64) NOT NULL UNIQUE,
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
      email TEXT,
      phone TEXT,
      password_hash TEXT,
      pin_hash TEXT,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      birth_date DATE,
      gender TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      user_id UUID REFERENCES users(id),
      teacher_code VARCHAR(64) NOT NULL UNIQUE,
      speciality TEXT,
      hire_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (school_id, name)
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
    CREATE TABLE IF NOT EXISTS subjects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      subject_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE TABLE IF NOT EXISTS course_schedule_slots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      class_name TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      teacher_id UUID REFERENCES teachers(id),
      slot_kind TEXT NOT NULL DEFAULT 'course',
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      school_id UUID REFERENCES schools(id),
      session_code UUID NOT NULL UNIQUE,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      revoke_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES schools(id),
      user_id UUID REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      old_value JSONB,
      new_value JSONB,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE TABLE IF NOT EXISTS terms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      subject_id UUID NOT NULL REFERENCES subjects(id),
      teacher_id UUID REFERENCES teachers(id),
      term_id UUID NOT NULL REFERENCES terms(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_id UUID NOT NULL REFERENCES students(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      subject_id UUID NOT NULL REFERENCES subjects(id),
      teacher_id UUID NOT NULL REFERENCES teachers(id),
      term_id UUID NOT NULL REFERENCES terms(id),
      score NUMERIC(8, 2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_id UUID NOT NULL REFERENCES students(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      teacher_id UUID REFERENCES teachers(id),
      attendance_date DATE NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_email
    ON users (school_id, lower(trim(email)))
    WHERE school_id IS NOT NULL AND email IS NOT NULL AND trim(email) <> ''
      AND COALESCE(status, 'active') NOT IN ('deleted', 'archived')`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_phone
    ON users (school_id, lower(trim(phone)))
    WHERE school_id IS NOT NULL AND phone IS NOT NULL AND trim(phone) <> ''
      AND COALESCE(status, 'active') NOT IN ('deleted', 'archived')`);

  await ensureTeacherAssignmentsActiveUniqueness(poolAdapter(pool), { info() {}, error() {} });

  for (const table of [
    "grades",
    "attendance",
    "evaluations",
    "sessions",
    "audit_logs",
    "course_schedule_slots",
    "school_courses",
    "teacher_assignments",
    "teachers",
    "users",
    "students",
    "terms",
    "classes",
    "subjects",
    "academic_years",
    "schools",
    "countries",
  ]) {
    await pool.query(`DELETE FROM ${table}`);
  }

  const country = await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`);
  const schools = await pool.query(
    `INSERT INTO schools (country_id, school_code, name)
     VALUES ($1, 'CD-2026-0001', 'Lycée Test 1'), ($1, 'CD-2026-0002', 'Lycée Test 2')
     RETURNING id, school_code`,
    [country.rows[0].id],
  );
  const school1 = schools.rows.find((row) => row.school_code === "CD-2026-0001");
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [school1.id],
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
    [school1.id, year.rows[0].id],
  );
  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 'active') RETURNING id`,
    [school1.id],
  );
  const term = await pool.query(
    `INSERT INTO terms (school_id, name) VALUES ($1, 'T1') RETURNING id`,
    [school1.id],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name)
     VALUES ($1, 'ELE-0001', 'Awa', 'Diop') RETURNING id`,
    [school1.id],
  );
  return {
    school1,
    classId: klass.rows[0].id,
    subjectId: subject.rows[0].id,
    termId: term.rows[0].id,
    studentId: student.rows[0].id,
  };
}

async function countAudit(pool, action, entityId) {
  const row = await pool.query(
    `SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = $1 AND entity_id::text = $2`,
    [action, String(entityId)],
  );
  return row.rows[0].c;
}

async function countTable(pool, sql, params = []) {
  const row = await pool.query(sql, params);
  return Number(row.rows[0].c ?? row.rows[0].users ?? 0);
}

function isNotNullViolation(error) {
  return String(error?.code) === "23502" || /null value in column "action"/i.test(String(error?.message ?? ""));
}

function createDbAdapter(pool, options = {}) {
  const adapter = {
    failAudit: options.failAudit ?? null,
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async getSchoolByCode(code) {
      return adapter.one(
        `SELECT id, school_code FROM schools WHERE school_code = $1 LIMIT 1`,
        [String(code).toUpperCase()],
      );
    },
    async recordAudit(payload, tx = null) {
      const executor = tx && typeof tx.query === "function" ? tx : adapter;
      const runOne =
        typeof executor.one === "function"
          ? (sql, params) => executor.one(sql, params)
          : async (sql, params) => {
              const result = await executor.query(sql, params);
              return result.rows?.[0] ?? null;
            };
      const school = payload.schoolCode
        ? await runOne(
            `SELECT id, school_code FROM schools WHERE school_code = $1 LIMIT 1`,
            [String(payload.schoolCode).toUpperCase()],
          )
        : null;
      let dbUserId = null;
      if (payload.userId) {
        const user = await runOne(
          `SELECT id FROM users WHERE id::text = $1 OR user_code = $1 LIMIT 1`,
          [String(payload.userId)],
        );
        dbUserId = user?.id ?? null;
      }
      if (adapter.failAudit && payload.action === adapter.failAudit) {
        await executor.query(
          `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id)
           VALUES ($1, $2, NULL, $3, $4)`,
          [school?.id ?? null, dbUserId, payload.entityType, payload.entityId ?? "forced-audit-failure"],
        );
        return;
      }
      await executor.query(
        `INSERT INTO audit_logs (
           school_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
        [
          school?.id ?? null,
          dbUserId,
          payload.action,
          payload.entityType,
          payload.entityId ?? null,
          payload.oldValue ? JSON.stringify(payload.oldValue) : null,
          payload.newValue ? JSON.stringify(payload.newValue) : null,
          payload.ipAddress ?? "",
          payload.userAgent ?? "",
        ],
      );
    },
    createTxScope(tx) {
      return {
        one: (sql, params) => tx.one(sql, params),
        all: (sql, params) => tx.all(sql, params),
        query: (sql, params) => tx.query(sql, params),
        getSchoolByCode: (code) =>
          tx.one(`SELECT id, school_code FROM schools WHERE school_code = $1 LIMIT 1`, [
            String(code).toUpperCase(),
          ]),
        recordAudit: (payload, innerTx) => adapter.recordAudit(payload, innerTx ?? tx),
        withTransaction: (fn) => fn(tx),
      };
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      const tx = createTxAdapter(client);
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return adapter;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP teacherLifecycleRepository.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, TEACHER_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    const fixture = await setupFixture(pool);
    const db = createDbAdapter(pool);
    const teachers = createTeachersRepository(db);
    const assignments = createTeacherAssignmentsRepository(db);
    const lifecycle = createTeacherLifecycleRepository(db);
    const principal = { sub: "admin-test", id: "admin-test" };

    const created = await teachers.create(
      {
        firstName: "Jean",
        lastName: "Kabeya",
        birthDate: "1988-03-15",
        gender: "Masculin",
        phone: "+243 810 100 201",
        email: "jean.kabeya@example.com",
        temporaryPassword: "TempPass1",
        speciality: "Mathématiques",
      },
      "CD-2026-0001",
      principal,
      { ipAddress: "127.0.0.1" },
    );
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users u JOIN schools s ON s.id = u.school_id WHERE s.school_code = 'CD-2026-0001') AS users,
         (SELECT COUNT(*)::int FROM teachers t JOIN schools s ON s.id = t.school_id WHERE s.school_code = 'CD-2026-0001') AS teachers,
         (SELECT COUNT(*)::int FROM audit_logs WHERE action = 'create_teacher' AND entity_id = $1) AS audits`,
      [created.teacherCode],
    );
    assert.equal(counts.rows[0].users, 1);
    assert.equal(counts.rows[0].teachers, 1);
    assert.equal(counts.rows[0].audits, 1);
    assert.equal(created.userId != null, true);

    const updated = await lifecycle.update(
      created.teacherCode,
      { firstName: "Jean-Paul", speciality: "Physique" },
      "CD-2026-0001",
      principal,
      {},
    );
    assert.equal(updated.firstName, "Jean-Paul");
    assert.equal(updated.speciality, "Physique");
    const pgRow = await pool.query(
      `SELECT u.first_name, t.speciality FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.teacher_code = $1`,
      [created.teacherCode],
    );
    assert.equal(pgRow.rows[0].first_name, "Jean-Paul");
    assert.equal(pgRow.rows[0].speciality, "Physique");
    assert.equal(await countAudit(pool, "update_teacher", created.teacherCode), 1);

    await assert.rejects(
      () => lifecycle.update(created.teacherCode, { schoolCode: "BI-2026-0002" }, "CD-2026-0001"),
      (error) => error.statusCode === 400,
    );
    await assert.rejects(
      () => lifecycle.update(created.teacherCode, { role: "Admin School" }, "CD-2026-0001"),
      (error) => error.statusCode === 400,
    );
    await assert.rejects(
      () => lifecycle.update(created.teacherCode, { teacherCode: "HACK" }, "CD-2026-0001"),
      (error) => error.statusCode === 400,
    );
    await assert.rejects(
      () => lifecycle.update(created.teacherCode, { userId: "x" }, "CD-2026-0001"),
      (error) => error.statusCode === 400,
    );

    const other = await teachers.create(
      {
        firstName: "Marie",
        lastName: "Mbala",
        birthDate: "1990-01-01",
        phone: "+243 810 100 202",
        email: "marie.mbala@example.com",
        temporaryPassword: "TempPass2",
      },
      "CD-2026-0001",
      principal,
      {},
    );
    assert.equal(await countAudit(pool, "create_teacher", other.teacherCode), 1);
    await assert.rejects(
      () => lifecycle.update(other.teacherCode, { email: "jean.kabeya@example.com" }, "CD-2026-0001"),
      (error) => error.statusCode === 409 && error.code === "TEACHER_LOGIN_IDENTITY_DUPLICATE",
    );
    await assert.rejects(
      () => lifecycle.update(other.teacherCode, { phone: "+243 810 100 201" }, "CD-2026-0001"),
      (error) => error.statusCode === 409 && error.code === "TEACHER_LOGIN_IDENTITY_DUPLICATE",
    );
    await assert.rejects(
      () =>
        lifecycle.update(
          other.teacherCode,
          { firstName: "Jean-Paul", lastName: "Kabeya", birthDate: "1988-03-15", gender: "Masculin" },
          "CD-2026-0001",
        ),
      (error) => error.statusCode === 409 && error.code === "TEACHER_CANON_AMBIGUOUS",
    );

    await assert.rejects(
      () => lifecycle.update(created.teacherCode, { speciality: "Chimie" }, "CD-2026-0002"),
      (error) => error.statusCode === 404,
    );
    assert.equal((await teachers.listBySchoolCode("CD-2026-0002")).length, 0);

    const teacherRow = await pool.query(`SELECT id, user_id FROM teachers WHERE teacher_code = $1`, [
      created.teacherCode,
    ]);
    const teacherId = teacherRow.rows[0].id;
    const userId = teacherRow.rows[0].user_id;

    const assignment = await assignments.create(
      { teacherCode: created.teacherCode, classCode: "CLS-6A", subjectCode: "SUB-MATH" },
      "CD-2026-0001",
      principal,
      {},
    );
    assert.equal(await countAudit(pool, "create_teacher_assignment", assignment.id), 1);

    await assignments.remove(assignment.id, "CD-2026-0001", principal, {});
    assert.equal(await countAudit(pool, "delete_teacher_assignment", assignment.id), 1);

    const recreated = await assignments.create(
      { teacherCode: created.teacherCode, classCode: "CLS-6A", subjectCode: "SUB-MATH" },
      "CD-2026-0001",
      principal,
      {},
    );
    assert.notEqual(String(recreated.id), String(assignment.id));
    assert.equal(await countAudit(pool, "create_teacher_assignment", recreated.id), 1);
    const assignmentHistory = await pool.query(
      `SELECT id, status FROM teacher_assignments WHERE teacher_id = $1 ORDER BY created_at`,
      [teacherId],
    );
    assert.equal(assignmentHistory.rows.length, 2);
    assert.equal(assignmentHistory.rows.filter((row) => row.status === "active").length, 1);
    assert.equal(assignmentHistory.rows.filter((row) => row.status === "deleted").length, 1);
    assert.equal(String(assignmentHistory.rows.find((row) => row.status === "deleted").id), String(assignment.id));
    assert.equal(String(assignmentHistory.rows.find((row) => row.status === "active").id), String(recreated.id));

    const updatedAssignment = await assignments.update(
      recreated.id,
      { teacherCode: created.teacherCode },
      "CD-2026-0001",
      principal,
      {},
    );
    assert.equal(String(updatedAssignment.id), String(recreated.id));
    assert.equal(await countAudit(pool, "update_teacher_assignment", recreated.id), 1);

    await pool.query(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, score)
       VALUES ($1, $2, $3, $4, $5, $6, 14)`,
      [fixture.school1.id, fixture.studentId, fixture.classId, fixture.subjectId, teacherId, fixture.termId],
    );
    await pool.query(
      `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, status)
       VALUES ($1, $2, $3, $4, $5, 'Devoir 1', 'open')`,
      [fixture.school1.id, fixture.classId, fixture.subjectId, teacherId, fixture.termId],
    );
    await pool.query(
      `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'present')`,
      [fixture.school1.id, fixture.studentId, fixture.classId, teacherId],
    );
    await pool.query(
      `INSERT INTO sessions (user_id, school_id, session_code, refresh_token_hash, role, expires_at)
       VALUES ($1, $2, gen_random_uuid(), $3, 'TEACHER', NOW() + INTERVAL '1 day')`,
      [userId, fixture.school1.id, `hash-${created.teacherCode}`],
    );

    const archived = await lifecycle.archive(created.teacherCode, "CD-2026-0001", principal, {});
    assert.deepEqual(archived, { teacherCode: created.teacherCode, archived: true });
    const archiveBundle = await pool.query(
      `SELECT
         (SELECT t.status FROM teachers t WHERE t.teacher_code = $1) AS teacher_status,
         (SELECT u.status FROM users u WHERE u.id = $2) AS user_status,
         (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id = $2 AND s.revoke_reason = 'teacher_archived' AND s.revoked_at IS NOT NULL) AS revoked,
         (SELECT COUNT(*)::int FROM teacher_assignments ta WHERE ta.teacher_id = $3 AND ta.status = 'active') AS active_assignments,
         (SELECT COUNT(*)::int FROM teacher_assignments ta WHERE ta.teacher_id = $3 AND ta.status = 'deleted') AS deleted_assignments,
         (SELECT COUNT(*)::int FROM audit_logs a WHERE a.action = 'archive_teacher' AND a.entity_id = $1) AS audits`,
      [created.teacherCode, userId, teacherId],
    );
    assert.equal(archiveBundle.rows[0].teacher_status, "archived");
    assert.equal(archiveBundle.rows[0].user_status, "archived");
    assert.equal(archiveBundle.rows[0].revoked, 1);
    assert.equal(archiveBundle.rows[0].active_assignments, 0);
    assert.equal(archiveBundle.rows[0].deleted_assignments, 2);
    assert.equal(archiveBundle.rows[0].audits, 1);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS c FROM grades WHERE teacher_id = $1`, [teacherId])).rows[0].c, 1);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS c FROM evaluations WHERE teacher_id = $1`, [teacherId])).rows[0].c, 1);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS c FROM attendance WHERE teacher_id = $1`, [teacherId])).rows[0].c, 1);
    assert.equal((await teachers.listBySchoolCode("CD-2026-0001")).some((row) => row.teacherCode === created.teacherCode), false);
    await assert.rejects(
      () => teachers.getByTeacherCode(created.teacherCode, "CD-2026-0001"),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () =>
        assignments.create(
          { teacherCode: created.teacherCode, classCode: "CLS-6A", subjectCode: "SUB-MATH" },
          "CD-2026-0001",
        ),
      (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_TEACHER_NOT_FOUND",
    );

    const blocked = await teachers.create(
      {
        firstName: "Paul",
        lastName: "Nkosi",
        birthDate: "1985-05-05",
        phone: "+243 810 100 203",
        temporaryPassword: "TempPass3",
      },
      "CD-2026-0001",
      principal,
      {},
    );
    const blockedId = (
      await pool.query(`SELECT id FROM teachers WHERE teacher_code = $1`, [blocked.teacherCode])
    ).rows[0].id;
    await pool.query(
      `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, status)
       VALUES ($1, $2, $3, $4, 'CRS-1', 'active')`,
      [fixture.school1.id, fixture.classId, fixture.subjectId, blockedId],
    );
    await assert.rejects(
      () => lifecycle.archive(blocked.teacherCode, "CD-2026-0001", principal, {}),
      (error) => error.statusCode === 409 && error.code === "TEACHER_ACTIVE_PEDAGOGY_REFERENCES",
    );
    await pool.query(`UPDATE school_courses SET status = 'archived' WHERE teacher_id = $1`, [blockedId]);
    await pool.query(
      `INSERT INTO course_schedule_slots (school_id, class_id, class_name, subject_name, teacher_id, starts_at, ends_at)
       VALUES ($1, $2, '6ème A', 'Mathématiques', $3, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours')`,
      [fixture.school1.id, fixture.classId, blockedId],
    );
    await assert.rejects(
      () => lifecycle.archive(blocked.teacherCode, "CD-2026-0001", principal, {}),
      (error) => error.statusCode === 409 && error.code === "TEACHER_ACTIVE_PEDAGOGY_REFERENCES",
    );

    const failUpdateDb = createDbAdapter(pool, { failAudit: "update_teacher" });
    const failUpdateLifecycle = createTeacherLifecycleRepository(failUpdateDb);
    const beforeName = await pool.query(
      `SELECT u.first_name FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.teacher_code = $1`,
      [other.teacherCode],
    );
    const auditsBeforeUpdateFail = await countTable(pool, `SELECT COUNT(*)::int AS c FROM audit_logs`);
    await assert.rejects(
      () => failUpdateLifecycle.update(other.teacherCode, { firstName: "Rollback" }, "CD-2026-0001", principal, {}),
      isNotNullViolation,
    );
    const afterName = await pool.query(
      `SELECT u.first_name FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.teacher_code = $1`,
      [other.teacherCode],
    );
    assert.equal(afterName.rows[0].first_name, beforeName.rows[0].first_name);
    assert.equal(await countTable(pool, `SELECT COUNT(*)::int AS c FROM audit_logs`), auditsBeforeUpdateFail);
    assert.equal(
      await countTable(pool, `SELECT COUNT(*)::int AS c FROM users u JOIN teachers t ON t.user_id = u.id WHERE u.first_name = 'Rollback'`),
      0,
    );

    const failArchiveDb = createDbAdapter(pool, { failAudit: "archive_teacher" });
    const failArchiveLifecycle = createTeacherLifecycleRepository(failArchiveDb);
    const free = await teachers.create(
      {
        firstName: "Luc",
        lastName: "Tshisekedi",
        birthDate: "1982-02-02",
        phone: "+243 810 100 204",
        temporaryPassword: "TempPass4",
      },
      "CD-2026-0001",
      principal,
      {},
    );
    const auditsBeforeArchiveFail = await countTable(pool, `SELECT COUNT(*)::int AS c FROM audit_logs`);
    await assert.rejects(
      () => failArchiveLifecycle.archive(free.teacherCode, "CD-2026-0001", principal, {}),
      isNotNullViolation,
    );
    const stillActive = await pool.query(`SELECT status FROM teachers WHERE teacher_code = $1`, [free.teacherCode]);
    assert.equal(stillActive.rows[0].status, "active");
    assert.equal(await countTable(pool, `SELECT COUNT(*)::int AS c FROM audit_logs`), auditsBeforeArchiveFail);

    const failAssignDb = createDbAdapter(pool, { failAudit: "create_teacher_assignment" });
    const failAssignments = createTeacherAssignmentsRepository(failAssignDb);
    const assignmentsBeforeFail = await countTable(pool, `SELECT COUNT(*)::int AS c FROM teacher_assignments`);
    const auditsBeforeAssignFail = await countTable(pool, `SELECT COUNT(*)::int AS c FROM audit_logs`);
    await assert.rejects(
      () =>
        failAssignments.create(
          { teacherCode: other.teacherCode, classCode: "CLS-6A", subjectCode: "SUB-MATH" },
          "CD-2026-0001",
          principal,
          {},
        ),
      isNotNullViolation,
    );
    assert.equal(await countTable(pool, `SELECT COUNT(*)::int AS c FROM teacher_assignments`), assignmentsBeforeFail);
    assert.equal(await countTable(pool, `SELECT COUNT(*)::int AS c FROM audit_logs`), auditsBeforeAssignFail);

    const raceA = await teachers.create(
      {
        firstName: "Race",
        lastName: "Alpha",
        birthDate: "1981-01-01",
        gender: "Masculin",
        phone: "+243 810 100 205",
        temporaryPassword: "TempPass5",
      },
      "CD-2026-0001",
      principal,
      {},
    );
    const raceB = await teachers.create(
      {
        firstName: "Race",
        lastName: "Beta",
        birthDate: "1981-02-02",
        gender: "Masculin",
        phone: "+243 810 100 206",
        temporaryPassword: "TempPass6",
      },
      "CD-2026-0001",
      principal,
      {},
    );
    const raced = await Promise.allSettled([
      lifecycle.update(
        raceA.teacherCode,
        { firstName: "Identique", lastName: "Canon", birthDate: "1980-12-12", gender: "Masculin" },
        "CD-2026-0001",
        principal,
        {},
      ),
      lifecycle.update(
        raceB.teacherCode,
        { firstName: "Identique", lastName: "Canon", birthDate: "1980-12-12", gender: "Masculin" },
        "CD-2026-0001",
        principal,
        {},
      ),
    ]);
    const fulfilled = raced.filter((item) => item.status === "fulfilled");
    const rejected = raced.filter((item) => item.status === "rejected");
    assert.equal(fulfilled.length, 1, "une seule modification concurrente de la même identité");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.statusCode, 409);
    assert.equal(rejected[0].reason.code, "TEACHER_CANON_AMBIGUOUS");

    const unauditedCreates = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM teachers t
       WHERE NOT EXISTS (
         SELECT 1 FROM audit_logs a
         WHERE a.action = 'create_teacher' AND a.entity_id = t.teacher_code
       )`,
    );
    assert.equal(unauditedCreates.rows[0].c, 0, "zéro création enseignant sans audit_logs");

    const orphanTeacherAudits = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM audit_logs a
       WHERE a.action IN ('create_teacher', 'update_teacher', 'archive_teacher')
         AND a.entity_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM teachers t WHERE t.teacher_code = a.entity_id)`,
    );
    assert.equal(orphanTeacherAudits.rows[0].c, 0, "zéro audit enseignant orphelin");

    const orphanAssignmentAudits = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM audit_logs a
       WHERE a.action IN ('create_teacher_assignment', 'update_teacher_assignment', 'delete_teacher_assignment')
         AND a.entity_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.id::text = a.entity_id)`,
    );
    assert.equal(orphanAssignmentAudits.rows[0].c, 0, "zéro audit affectation orphelin");

    console.log("teacherLifecycleRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
