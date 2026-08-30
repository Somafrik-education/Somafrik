"use strict";

/**
 * Roster Présences — inscriptions PostgreSQL (cas A–D, C homonymes, H tenant).
 * Clé métier = class_id, jamais classes.name / student.className.
 */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PRESENCES_ROSTER_IT_DATABASE ?? "somafrik_presences_roster_it")
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

async function setupSchema(pool) {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DROP TABLE IF EXISTS enrollments CASCADE;
    DROP TABLE IF EXISTS students CASCADE;
    DROP TABLE IF EXISTS classes CASCADE;
    DROP TABLE IF EXISTS academic_years CASCADE;
    DROP TABLE IF EXISTS schools CASCADE;
    DROP TABLE IF EXISTS countries CASCADE;

    CREATE TABLE countries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      iso_code VARCHAR(8) NOT NULL UNIQUE
    );
    CREATE TABLE schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      school_code VARCHAR(64) NOT NULL UNIQUE,
      login_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      class_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      level TEXT,
      section TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_code VARCHAR(64) NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      gender TEXT,
      birth_date DATE,
      birth_place TEXT,
      photo_url TEXT,
      parent_phone TEXT,
      parent_email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_id UUID NOT NULL REFERENCES students(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      enrollment_date DATE DEFAULT CURRENT_DATE,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
}

function createAdapter(pool) {
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
        `SELECT id, school_code, login_code FROM schools WHERE upper(login_code) = $1 LIMIT 1`,
        [String(code ?? "").trim().toUpperCase()],
      );
      return result.rows[0] ?? null;
    },
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP presencesRoster.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await setupSchema(pool);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name)
       VALUES ($1, 'SCH-PRE-A', 'CD-PRA-26-001', 'École A') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name)
       VALUES ($1, 'SCH-PRE-B', 'CD-PRB-26-001', 'École B') RETURNING id`,
      [country.rows[0].id],
    );
    const yearA = await pool.query(
      `INSERT INTO academic_years (school_id, name) VALUES ($1, '2025-2026') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const yearB = await pool.query(
      `INSERT INTO academic_years (school_id, name) VALUES ($1, '2025-2026') RETURNING id`,
      [schoolB.rows[0].id],
    );

    const classAId = randomUUID();
    const classBId = randomUUID();
    const classForeignId = randomUUID();
    await pool.query(
      `INSERT INTO classes (id, school_id, academic_year_id, class_code, name)
       VALUES
         ($1, $2, $3, 'CLS-PRE-A', '2ème A'),
         ($4, $2, $3, 'CLS-PRE-B', '2ème A'),
         ($5, $6, $7, 'CLS-PRE-X', '2ème A')`,
      [classAId, schoolA.rows[0].id, yearA.rows[0].id, classBId, classForeignId, schoolB.rows[0].id, yearB.rows[0].id],
    );

    const studentActive = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'ELE-PRE-001', 'Awa', 'Diop') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const studentInactive = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'ELE-PRE-002', 'Ibrahim', 'Sow') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES
         ($1, $2, $3, $4, 'active'),
         ($1, $5, $3, $4, 'archived')`,
      [schoolA.rows[0].id, studentActive.rows[0].id, classAId, yearA.rows[0].id, studentInactive.rows[0].id],
    );

    const repo = createClassStudentsRepository(createAdapter(pool));

    const rosterA = await repo.listByClassCode("CLS-PRE-A", "CD-PRA-26-001");
    const rosterB = await repo.listByClassCode("CLS-PRE-B", "CD-PRA-26-001");

    // A / B — inscription active, indépendamment d'un libellé élève (le DTO className est une projection classes.name).
    assert.equal(rosterA.length, 1, "A/B — roster classe A = 1");
    assert.equal(rosterA[0].studentCode, "ELE-PRE-001");
    assert.equal(rosterA[0].classId, classAId);
    assert.equal(rosterA[0].classCode, "CLS-PRE-A");
    assert.equal(rosterA[0].className, "2ème A");
    assert.notEqual(rosterA[0].classId, rosterA[0].classCode);

    // C — homonymes UUID distincts : élève uniquement en A.
    assert.equal(rosterB.length, 0, "C — roster classe B homonyme = 0");
    assert.notEqual(classAId, classBId);

    // D — inscription archivée absente du roster A.
    assert.ok(!rosterA.some((row) => row.studentCode === "ELE-PRE-002"), "D — inscription inactive absente");

    // H — tenant étranger fail-closed.
    await assert.rejects(
      () => repo.listByClassCode("CLS-PRE-A", "CD-PRB-26-001"),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => repo.listByClassCode("CLS-PRE-X", "CD-PRA-26-001"),
      (error) => error.statusCode === 404,
    );

    const foreignRoster = await repo.listByClassCode("CLS-PRE-X", "CD-PRB-26-001");
    assert.equal(foreignRoster.length, 0);

    console.log("presencesRoster.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
