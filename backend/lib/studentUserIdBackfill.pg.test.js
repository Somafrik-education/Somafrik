"use strict";

/**
 * Boot 20260907 : un UPDATE students SET user_id réévalue
 * students_canonical_identifier_format_check (même NOT VALID).
 * Une ligne historique hors format ne doit pas faire échouer le démarrage.
 *
 * Régression couverte en plus : le bloc CHECK de 20260823 ne doit pas
 * rétrograder une CHECK runtime plus large (SEQ5 | EL) en EL-only.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_STUDENT_USER_ID_BACKFILL_IT_DATABASE ?? "somafrik_student_user_id_backfill_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260907_student_user_id.sql"),
  "utf8",
);
const MIGRATION_23_SQL = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260823_student_canonical_identifier.sql"),
  "utf8",
);

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const maintenance = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenance });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function getConstraintDef(pool) {
  const result = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def, convalidated
     FROM pg_constraint
     WHERE conname = 'students_canonical_identifier_format_check'`,
  );
  return result.rows[0] ?? null;
}

function checkOnlyBlock(sql) {
  const marker = "-- CHECK NOT VALID";
  const markerAt = sql.lastIndexOf(marker);
  assert.ok(markerAt >= 0, "bloc CHECK 20260823 introuvable");
  const block = sql.slice(markerAt);
  const doAt = block.indexOf("DO $$");
  assert.ok(doAt >= 0, "DO CHECK 20260823 introuvable");
  return block.slice(doAt);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentUserIdBackfill.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await pool.query(`
      CREATE TABLE countries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        iso_code VARCHAR(8) NOT NULL UNIQUE
      );
      CREATE TABLE schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_id UUID NOT NULL REFERENCES countries(id),
        school_code VARCHAR(64) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        user_code VARCHAR(64) NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        role TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        identity_code TEXT,
        login_code TEXT
      );
      CREATE TABLE students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_code VARCHAR(64) NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        identity_code TEXT,
        login_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, name)
       VALUES ($1, 'CD-2026-0001', 'Nuru') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolId = school.rows[0].id;

    const legacyStudent = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, identity_code, login_code)
       VALUES ($1, 'LEGACY-STU-1', 'Awa', 'Diop', 'OLD', 'OLD')
       RETURNING id`,
      [schoolId],
    );
    const legacyUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, identity_code, login_code)
       VALUES ($1, 'LEGACY-STU-1', 'Awa', 'Diop', 'STUDENT', 'LEGACY-STU-1', 'LEGACY-STU-1')
       RETURNING id`,
      [schoolId],
    );
    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, identity_code, login_code)
       VALUES ($1, 'CD-IN-AD-26-00001', 'Esther', 'Okito', 'CD-IN-AD-26-00001', 'CD-IN-AD-26-00001')`,
      [schoolId],
    );
    const canonicalUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, identity_code, login_code)
       VALUES ($1, 'CD-IN-AD-26-00001', 'Esther', 'Okito', 'STUDENT', 'CD-IN-AD-26-00001', 'CD-IN-AD-26-00001')
       RETURNING id`,
      [schoolId],
    );
    const unsyncedStudent = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, identity_code, login_code)
       VALUES ($1, 'CD-IN-MR-26-00003', 'Marc', 'Rumba', NULL, NULL)
       RETURNING id`,
      [schoolId],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, identity_code, login_code)
       VALUES ($1, 'CD-IN-MR-26-00003', 'Marc', 'Rumba', 'STUDENT', 'CD-IN-MR-26-00003', 'CD-IN-MR-26-00003')`,
      [schoolId],
    );

    await pool.query(`
      ALTER TABLE students ADD CONSTRAINT students_canonical_identifier_format_check
      CHECK (
        (
          student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
          OR student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
        )
        AND login_code IS NOT DISTINCT FROM student_code
        AND identity_code IS NOT DISTINCT FROM student_code
      ) NOT VALID
    `);

    const before23 = await getConstraintDef(pool);
    assert.ok(before23);
    assert.equal(before23.convalidated, false);
    assert.match(before23.def, /\{1,5\}.*\{5\}/, "CHECK runtime doit accepter SEQ5");

    await pool.query(checkOnlyBlock(MIGRATION_23_SQL));

    const after23 = await getConstraintDef(pool);
    assert.ok(after23);
    assert.equal(after23.convalidated, false);
    assert.equal(after23.def, before23.def, "20260823 ne doit pas rétrograder la CHECK runtime");

    await pool.query(MIGRATION_SQL);

    const after = await pool.query(
      `SELECT student_code, user_id::text AS user_id
       FROM students
       ORDER BY student_code`,
    );
    const byCode = Object.fromEntries(after.rows.map((row) => [row.student_code, row.user_id]));
    assert.equal(byCode["LEGACY-STU-1"], null, "ligne historique exclue du backfill");
    assert.equal(byCode["CD-IN-MR-26-00003"], null, "login/identity NULL : exclue, identité non réécrite");
    assert.equal(byCode["CD-IN-AD-26-00001"], String(canonicalUser.rows[0].id));
    assert.equal(legacyStudent.rows[0].id.length > 0, true);
    assert.equal(legacyUser.rows[0].id.length > 0, true);
    assert.equal(unsyncedStudent.rows[0].id.length > 0, true);

    const identity = await pool.query(
      `SELECT student_code, identity_code, login_code FROM students WHERE student_code = 'LEGACY-STU-1'`,
    );
    assert.equal(identity.rows[0].identity_code, "OLD");
    assert.equal(identity.rows[0].login_code, "OLD");

    console.log("studentUserIdBackfill.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
