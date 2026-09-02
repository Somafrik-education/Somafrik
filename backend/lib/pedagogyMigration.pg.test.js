"use strict";

/**
 * Migration LOT 5 — enforcement NOT NULL sur course_schedule_slots.class_id
 * pour une table existante créée avec class_id nullable.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const MIGRATION_DATABASE = String(process.env.SOMAFRIK_PEDAGOGY_MIGRATION_IT_DATABASE ?? "somafrik_pedagogy_migration_it")
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

async function main() {
  if (!DATABASE_URL) {
    console.log("pedagogyMigration.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, MIGRATION_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-MIG-0001', 'Migration school', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [school.rows[0].id],
    );
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-MIG', '6ème MIG', 'active') RETURNING id`,
      [school.rows[0].id, year.rows[0].id],
    );

    await pool.query(`
      CREATE TABLE course_schedule_slots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        class_id UUID REFERENCES classes(id),
        class_name TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        teacher_id UUID REFERENCES teachers(id),
        slot_kind TEXT NOT NULL DEFAULT 'course',
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        room TEXT,
        exam_name TEXT,
        exam_type TEXT,
        exam_id UUID,
        period_name TEXT,
        period_start DATE,
        period_end DATE,
        legacy_json_id TEXT,
        profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(
      `INSERT INTO course_schedule_slots (school_id, class_id, class_name, subject_name, starts_at, ends_at)
       VALUES ($1, $2, '6ème MIG', 'Mathématiques', '2026-10-01T08:00:00Z', '2026-10-01T09:00:00Z')`,
      [school.rows[0].id, klass.rows[0].id],
    );
    await pool.query(
      `INSERT INTO course_schedule_slots (school_id, class_id, class_name, subject_name, starts_at, ends_at)
       VALUES ($1, NULL, '6ème MIG', 'Latin', '2026-10-03T08:00:00Z', '2026-10-03T09:00:00Z')`,
      [school.rows[0].id],
    );

    const migrationSql = fs.readFileSync(
      path.join(__dirname, "../db/migrations/20260813_pedagogy_canonical.sql"),
      "utf8",
    );
    await assert.rejects(
      () => pool.query(migrationSql),
      (error) => /NULL class_id rows|class_id NULL/i.test(String(error.message)),
      "migration refuse les lignes orphelines class_id NULL",
    );

    await pool.query(`DELETE FROM course_schedule_slots WHERE class_id IS NULL`);
    await pool.query(migrationSql);

    const nullableCheck = await pool.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'course_schedule_slots' AND column_name = 'class_id'
    `);
    assert.equal(nullableCheck.rows[0].is_nullable, "NO", "class_id doit être NOT NULL après migration");

    await pool
      .query(
        `INSERT INTO course_schedule_slots (school_id, class_name, subject_name, starts_at, ends_at)
         VALUES ($1, '6ème MIG', 'Physique', '2026-10-02T08:00:00Z', '2026-10-02T09:00:00Z')`,
        [school.rows[0].id],
      )
      .then(
        () => {
          throw new Error("INSERT sans class_id aurait dû échouer");
        },
        (error) => {
          assert.match(String(error.message), /null value|not-null/i);
        },
      );

    console.log("pedagogyMigration.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
