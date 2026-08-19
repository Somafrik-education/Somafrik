"use strict";

/**
 * Intégration PostgreSQL — création enseignant + compte :
 * transaction, relecture, ambiguïté, homonymes, rollback, isolation.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createTeachersRepository } = require("../db/teachersRepository");
const { createTeacherAssignmentsRepository } = require("../db/teacherAssignmentsRepository");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureTeachersLegacyCodeSchema } = require("../db/teachersLegacyCodeSchema");
const { verifySecret } = require("../services/credentialService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const TEACHER_IT_DATABASE = String(
  process.env.SOMAFRIK_TEACHER_ACCOUNT_IT_DATABASE ?? "somafrik_teacher_account_it",
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
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;

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

    CREATE UNIQUE INDEX IF NOT EXISTS teachers_school_user_unique
      ON teachers (school_id, user_id)
      WHERE user_id IS NOT NULL;

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
  `);
  await ensureTeachersLegacyCodeSchema(pool);

  const { ensureTeacherAssignmentsActiveUniqueness } = require("./teacherAssignmentsUniqueness");
  await ensureTeacherAssignmentsActiveUniqueness(
    {
      one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
      all: async (sql, params) => (await pool.query(sql, params)).rows,
      query: (sql, params) => pool.query(sql, params),
    },
    { info() {}, error() {} },
  );

  await pool.query(`DELETE FROM teacher_assignments`);
  await pool.query(`DELETE FROM teachers`);
  await pool.query(`DELETE FROM users`);
  await pool.query(`DELETE FROM classes`);
  await pool.query(`DELETE FROM subjects`);
  await pool.query(`DELETE FROM academic_years`);
  await pool.query(`DELETE FROM schools`);
  await pool.query(`DELETE FROM countries`);

  const country = await pool.query(
    `INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`,
  );
  const schools = await pool.query(
    `INSERT INTO schools (country_id, school_code, name)
     VALUES ($1, 'CD-2026-0001', 'Lycée Test 1'), ($1, 'CD-2026-0002', 'Lycée Test 2')
     RETURNING id, school_code`,
    [country.rows[0].id],
  );
  const school1 = schools.rows.find((row) => row.school_code === "CD-2026-0001");
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [school1.id],
  );
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-6A', '6ème A', 'active')`,
    [school1.id, year.rows[0].id],
  );
  await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 'active')`,
    [school1.id],
  );
}

function createDbAdapter(pool) {
  return {
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
      const result = await pool.query(
        `SELECT id, school_code FROM schools WHERE school_code = $1 LIMIT 1`,
        [String(code).toUpperCase()],
      );
      return result.rows[0] ?? null;
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
}

function wrapTxFailingTeacherInsert(tx) {
  return {
    ...tx,
    async one(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (normalized.startsWith("INSERT INTO TEACHERS")) {
        const error = new Error("forced teacher insert failure");
        error.code = "FORCE_TEACHER_FAIL";
        throw error;
      }
      return tx.one(sql, params);
    },
  };
}

function createRollbackTestRepository(baseDb) {
  return createTeachersRepository({
    ...baseDb,
    withTransaction: async (fn) =>
      baseDb.withTransaction(async (tx) => fn(wrapTxFailingTeacherInsert(tx))),
  });
}

async function countUsers(pool, schoolCode) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM users u
     JOIN schools s ON s.id = u.school_id
     WHERE s.school_code = $1`,
    [schoolCode],
  );
  return result.rows[0].count;
}

async function countTeachers(pool, schoolCode) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM teachers t
     JOIN schools s ON s.id = t.school_id
     WHERE s.school_code = $1`,
    [schoolCode],
  );
  return result.rows[0].count;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP teachersRepository.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, TEACHER_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await setupFixture(pool);
    const db = createDbAdapter(pool);
    const repo = createTeachersRepository(db);
    const assignmentsRepo = createTeacherAssignmentsRepository(db);

    const created = await repo.create(
      {
        firstName: "Jean",
        lastName: "Kabeya",
        birthDate: "1988-03-15",
        gender: "Masculin",
        phone: "+243 810 000 201",
        temporaryPassword: "TempPass1",
        speciality: "Mathématiques",
      },
      "CD-2026-0001",
    );
    assert.match(created.teacherCode, /^CD-2026-0001-ENS-\d{4}$/);
    assert.equal(created.mustChangePassword, true);

    const pgUser = await pool.query(
      `SELECT user_code, password_hash, must_change_password, role, birth_date
       FROM users WHERE user_code = $1`,
      [created.teacherCode],
    );
    assert.equal(pgUser.rows.length, 1);
    assert.equal(pgUser.rows[0].role, "TEACHER");
    assert.equal(pgUser.rows[0].must_change_password, true);
    assert.ok(verifySecret("TempPass1", pgUser.rows[0].password_hash));

    const reread = await repo.getByTeacherCode(created.teacherCode, "CD-2026-0001");
    assert.equal(reread.firstName, "Jean");
    assert.equal(reread.identifier, created.identifier);

    await repo.create(
      {
        firstName: "Jean",
        lastName: "Kabeya",
        birthDate: "1992-01-01",
        phone: "+243 810 000 202",
        temporaryPassword: "TempPass2",
      },
      "CD-2026-0001",
    );

    await assert.rejects(
      () =>
        repo.create(
          {
            firstName: "Jean",
            lastName: "Kabeya",
            birthDate: "1988-03-15",
            phone: "+243 810 000 203",
            temporaryPassword: "TempPass3",
          },
          "CD-2026-0001",
        ),
      (error) => error.statusCode === 409 && error.code === "TEACHER_CANON_AMBIGUOUS",
    );

    const otherSchool = await repo.create(
      {
        firstName: "Jean",
        lastName: "Kabeya",
        birthDate: "1988-03-15",
        phone: "+243 810 000 204",
        temporaryPassword: "TempPass4",
      },
      "CD-2026-0002",
    );
    assert.equal(otherSchool.schoolCode, "CD-2026-0002");
    assert.equal((await repo.listBySchoolCode("CD-2026-0001")).length, 2);
    assert.equal((await repo.listBySchoolCode("CD-2026-0002")).length, 1);

    const rollbackRepo = createRollbackTestRepository(db);
    const beforeUsers = await countUsers(pool, "CD-2026-0001");
    const beforeTeachers = await countTeachers(pool, "CD-2026-0001");
    await assert.rejects(
      () =>
        rollbackRepo.create(
          {
            firstName: "Rollback",
            lastName: "Case",
            birthDate: "1980-01-01",
            phone: "+243 810 000 205",
            temporaryPassword: "TempPass5",
          },
          "CD-2026-0001",
        ),
      (error) => error.code === "FORCE_TEACHER_FAIL",
    );
    assert.equal(await countUsers(pool, "CD-2026-0001"), beforeUsers);
    assert.equal(await countTeachers(pool, "CD-2026-0001"), beforeTeachers);

    const concurrent = await Promise.all([
      repo.create(
        {
          firstName: "Concurrent",
          lastName: "One",
          birthDate: "1987-02-02",
          phone: "+243 810 000 206",
          temporaryPassword: "TempPass6",
        },
        "CD-2026-0001",
      ),
      repo.create(
        {
          firstName: "Concurrent",
          lastName: "Two",
          birthDate: "1987-03-03",
          phone: "+243 810 000 207",
          temporaryPassword: "TempPass7",
        },
        "CD-2026-0001",
      ),
    ]);
    assert.notEqual(concurrent[0].teacherCode, concurrent[1].teacherCode);

    // Course identité canonique : une seule réussite, l'autre 409 TEACHER_CANON_AMBIGUOUS.
    const sameIdentity = {
      firstName: "Race",
      lastName: "Canon",
      birthDate: "1984-07-07",
      gender: "Masculin",
      phone: "+243 810 000 208",
      temporaryPassword: "TempPass8",
    };
    const raced = await Promise.allSettled([
      repo.create({ ...sameIdentity, phone: "+243 810 000 208" }, "CD-2026-0001"),
      repo.create({ ...sameIdentity, phone: "+243 810 000 209", temporaryPassword: "TempPass9" }, "CD-2026-0001"),
    ]);
    const fulfilled = raced.filter((item) => item.status === "fulfilled");
    const rejected = raced.filter((item) => item.status === "rejected");
    assert.equal(fulfilled.length, 1, "une seule création concurrente de la même identité");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.statusCode, 409);
    assert.equal(rejected[0].reason.code, "TEACHER_CANON_AMBIGUOUS");

    // Non-régression affectations actives dans liste + détail.
    const withAssign = fulfilled[0].value;
    const teacherUuid = await pool.query(`SELECT id, school_id FROM teachers WHERE teacher_code = $1`, [
      withAssign.teacherCode,
    ]);
    const classRow = await pool.query(
      `SELECT id, academic_year_id FROM classes WHERE class_code = 'CLS-6A' LIMIT 1`,
    );
    const subjectRow = await pool.query(
      `SELECT id FROM subjects WHERE subject_code = 'SUB-MATH' LIMIT 1`,
    );
    const createdAssignment = await assignmentsRepo.create(
      {
        teacherCode: withAssign.teacherCode,
        classCode: "CLS-6A",
        subjectCode: "SUB-MATH",
      },
      "CD-2026-0001",
    );
    assert.equal(createdAssignment.teacherCode, withAssign.teacherCode);
    assert.equal(createdAssignment.className, "6ème A");
    assert.equal(createdAssignment.subject, "Mathématiques");
    await assert.rejects(
      () => assignmentsRepo.create(
        { teacherCode: created.teacherCode, classCode: "CLS-6A", subjectCode: "SUB-MATH" },
        "CD-2026-0001",
      ),
      (error) => error.statusCode === 409 && error.code === "ASSIGNMENT_COURSE_CONFLICT",
    );
    await pool.query(
      `INSERT INTO teacher_assignments (
         school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status
       ) VALUES ($1, $2, $3, $4, $5, 'secondary', 'inactive')`,
      [
        teacherUuid.rows[0].school_id,
        teacherUuid.rows[0].id,
        classRow.rows[0].id,
        subjectRow.rows[0].id,
        classRow.rows[0].academic_year_id,
      ],
    );

    const listedWithAssign = await repo.listBySchoolCode("CD-2026-0001");
    const listedTeacher = listedWithAssign.find((row) => row.teacherCode === withAssign.teacherCode);
    assert.ok(listedTeacher);
    assert.equal(listedTeacher.assignments.length, 1);
    assert.equal(listedTeacher.assignments[0].className, "6ème A");
    assert.equal(listedTeacher.assignments[0].course, "Mathématiques");
    assert.deepEqual(listedTeacher.assignedClasses, ["6ème A"]);
    assert.deepEqual(listedTeacher.courses, ["Mathématiques"]);

    const detail = await repo.getByTeacherCode(withAssign.teacherCode, "CD-2026-0001");
    assert.equal(detail.assignments.length, 1);
    assert.deepEqual(detail.assignedClasses, ["6ème A"]);

    const reassigned = await assignmentsRepo.update(
      createdAssignment.id,
      { teacherCode: created.teacherCode },
      "CD-2026-0001",
    );
    assert.equal(reassigned.teacherCode, created.teacherCode);
    await assert.rejects(
      () => assignmentsRepo.update(createdAssignment.id, { teacherCode: otherSchool.teacherCode }, "CD-2026-0001"),
      (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_TEACHER_NOT_FOUND",
    );
    assert.deepEqual(
      await assignmentsRepo.remove(createdAssignment.id, "CD-2026-0001"),
      { id: createdAssignment.id, deleted: true },
    );
    assert.equal((await assignmentsRepo.listBySchoolCode("CD-2026-0001")).length, 0);

    console.log("teachersRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
