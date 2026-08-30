"use strict";

/**
 * Intégration PostgreSQL — matières d'établissement + affectations.
 * Isolation inter-écoles, matière inactive/inexistante, doublon.
 *
 * Prérequis : DATABASE_URL (CI). Aucune insertion manuelle hors fixture de test.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createTeacherAssignmentsRepository } = require("../db/teacherAssignmentsRepository");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureTeacherAssignmentsActiveUniqueness } = require("./teacherAssignmentsUniqueness");
const { ensureTeachersLegacyCodeSchema } = require("../db/teachersLegacyCodeSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_SUBJECTS_ASSIGNMENTS_IT_DATABASE ?? "somafrik_subjects_assignments_it")
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      school_code VARCHAR(64) NOT NULL UNIQUE,
      login_code TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS login_code TEXT;
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES schools(id),
      user_code VARCHAR(64) NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      user_id UUID REFERENCES users(id),
      teacher_code VARCHAR(64) NOT NULL UNIQUE,
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
  `);
  await ensureTeachersLegacyCodeSchema(pool);

  const poolAdapter = {
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
  };
  await ensureTeacherAssignmentsActiveUniqueness(poolAdapter, { info() {}, error() {} });

  for (const table of [
    "teacher_assignments",
    "teachers",
    "users",
    "subjects",
    "classes",
    "academic_years",
    "schools",
    "countries",
  ]) {
    await pool.query(`DELETE FROM ${table}`);
  }

  const country = await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`);
  const schools = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name)
     VALUES ($1, 'CD-2026-0001', 'CD-SA-26-001', 'Lycée A'),
            ($1, 'CD-2026-0002', 'CD-SB-26-001', 'Lycée B')
     RETURNING id, school_code, login_code`,
    [country.rows[0].id],
  );
  const schoolA = schools.rows.find((row) => row.school_code === "CD-2026-0001");
  const schoolB = schools.rows.find((row) => row.school_code === "CD-2026-0002");

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [schoolA.id],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [schoolB.id],
  );
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-1A', '1ère A', 'active')`,
    [schoolA.id, yearA.rows[0].id],
  );
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-B', '6ème B', 'active')`,
    [schoolB.id, yearB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES
       ($1, 'SUB-MATH', 'Mathématiques', 'active'),
       ($1, 'SUB-OLD', 'Ancienne', 'archived'),
       ($2, 'SUB-BIO', 'Biologie', 'active')`,
    [schoolA.id, schoolB.id],
  );
  const userA = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, 'CD-SA-AD-26-00001', 'Awa', 'Diop', 'TEACHER', 'active') RETURNING id`,
    [schoolA.id],
  );
  const userB = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, 'CD-SB-JO-26-00001', 'Jean', 'Other', 'TEACHER', 'active') RETURNING id`,
    [schoolB.id],
  );
  await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'CD-2026-0001-ENS-0001', 'active')`,
    [schoolA.id, userA.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'CD-2026-0002-ENS-0001', 'active')`,
    [schoolB.id, userB.rows[0].id],
  );

  return { schoolA, schoolB };
}

function createDbAdapter(pool) {
  const adapter = {
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
        `SELECT id, school_code, login_code FROM schools WHERE upper(login_code) = $1 LIMIT 1`,
        [String(code).toUpperCase()],
      );
    },
    createTxScope(tx) {
      return {
        one: (sql, params) => tx.one(sql, params),
        all: (sql, params) => tx.all(sql, params),
        query: (sql, params) => tx.query(sql, params),
        getSchoolByCode: (code) =>
          tx.one(
            `SELECT id, school_code, login_code FROM schools WHERE upper(login_code) = $1 LIMIT 1`,
            [String(code).toUpperCase()],
          ),
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

const SUBJECTS_FOR_SCHOOL_SQL = `
  SELECT sub.subject_code, sub.name, sub.status, s.school_code
  FROM subjects sub
  JOIN schools s ON s.id = sub.school_id
  WHERE upper(s.school_code) = $1
  ORDER BY sub.subject_code
`;

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP subjectsAssignments.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await setupFixture(pool);
    const repo = createTeacherAssignmentsRepository(createDbAdapter(pool));

    const schoolASubjects = await pool.query(SUBJECTS_FOR_SCHOOL_SQL, ["CD-2026-0001"]);
    assert.equal(schoolASubjects.rows.length, 2);
    assert.ok(schoolASubjects.rows.some((row) => row.subject_code === "SUB-MATH" && row.name === "Mathématiques" && row.status === "active"));
    assert.ok(schoolASubjects.rows.some((row) => row.subject_code === "SUB-OLD" && row.status === "archived"));
    assert.equal(
      schoolASubjects.rows.some((row) => row.subject_code === "SUB-BIO"),
      false,
      "la matière de l'école B ne doit pas apparaître pour l'école A",
    );

    const schoolBSubjects = await pool.query(SUBJECTS_FOR_SCHOOL_SQL, ["CD-2026-0002"]);
    assert.equal(schoolBSubjects.rows.length, 1);
    assert.equal(schoolBSubjects.rows[0].subject_code, "SUB-BIO");
    assert.equal(
      schoolBSubjects.rows.some((row) => row.subject_code === "SUB-MATH"),
      false,
    );

    const created = await repo.create(
      { teacherCode: "CD-SA-AD-26-00001", classCode: "CLS-1A", subjectCode: "SUB-MATH" },
      "CD-SA-26-001",
    );
    assert.ok(created.id);
    assert.equal(created.subjectCode, "SUB-MATH");
    assert.equal(created.classCode, "CLS-1A");
    const persisted = await pool.query(
      `SELECT ta.id, sub.subject_code, cl.class_code, s.school_code
       FROM teacher_assignments ta
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN classes cl ON cl.id = ta.class_id
       JOIN schools s ON s.id = ta.school_id
       WHERE ta.id::text = $1`,
      [created.id],
    );
    assert.equal(persisted.rows.length, 1);
    assert.equal(persisted.rows[0].school_code, "CD-2026-0001");
    assert.equal(persisted.rows[0].subject_code, "SUB-MATH");

    await assert.rejects(
      () =>
        repo.create(
          { teacherCode: "CD-SA-AD-26-00001", classCode: "CLS-1A", subjectCode: "SUB-MATH" },
          "CD-SA-26-001",
        ),
      (error) => error.statusCode === 409 && error.code === "TEACHER_ASSIGNMENT_ALREADY_EXISTS",
    );
    await assert.rejects(
      () =>
        repo.create(
          { teacherCode: "CD-SA-AD-26-00001", classCode: "CLS-1A", subjectCode: "SUB-OLD" },
          "CD-SA-26-001",
        ),
      (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_SUBJECT_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        repo.create(
          { teacherCode: "CD-SA-AD-26-00001", classCode: "CLS-1A", subjectCode: "SUB-UNKNOWN" },
          "CD-SA-26-001",
        ),
      (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_SUBJECT_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        repo.create(
          { teacherCode: "CD-SA-AD-26-00001", classCode: "CLS-1A", subjectCode: "SUB-BIO" },
          "CD-SA-26-001",
        ),
      (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_SUBJECT_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        repo.create(
          { teacherCode: "CD-SB-JO-26-00001", classCode: "CLS-1A", subjectCode: "SUB-MATH" },
          "CD-SA-26-001",
        ),
      (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_TEACHER_NOT_FOUND",
    );

    console.log("subjectsAssignments.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
