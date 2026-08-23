"use strict";

/**
 * PR-1A — PostgreSQL réel : unicité structurelle NULLS NOT DISTINCT.
 * Prérequis : DATABASE_URL (CI locale). Aucun secret de secours.
 */

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const {
  CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  COUNT_CLASSES_STRUCTURAL_DUPLICATE_GROUPS_SQL,
  assertClassesStructuralUniquenessPreflight,
  CLASSES_STRUCTURAL_DUPLICATE_ERROR,
  CLASSES_STRUCTURAL_UNIQUE_INDEX,
} = require("./classesUniqueness");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_CLASSES_NULL_IT_DATABASE ?? "somafrik_classes_null_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
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
  };
}

async function setupSchema(pool) {
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
    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'open',
      UNIQUE (school_id, name)
    );
    CREATE TABLE IF NOT EXISTS education_levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      level_code TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS education_streams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      stream_code TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS education_class_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      group_code TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      class_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      level_id UUID REFERENCES education_levels(id),
      stream_id UUID REFERENCES education_streams(id),
      group_id UUID REFERENCES education_class_groups(id)
    );
  `);
  await pool.query(
    "TRUNCATE classes, education_class_groups, education_streams, education_levels, academic_years, schools, countries CASCADE",
  );
}

async function seed(pool) {
  const country = (await pool.query(
    `INSERT INTO countries (name, iso_code) VALUES ('Testland', 'TT') RETURNING id`,
  )).rows[0].id;
  const school = (await pool.query(
    `INSERT INTO schools (country_id, school_code, name) VALUES ($1, 'SCH-A', 'École A') RETURNING id`,
    [country],
  )).rows[0].id;
  const year = (await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current) VALUES ($1, '2026-2027', TRUE) RETURNING id`,
    [school],
  )).rows[0].id;
  const level = (await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name) VALUES ($1, '3eme', '3ème') RETURNING id`,
    [country],
  )).rows[0].id;
  const streamBio = (await pool.query(
    `INSERT INTO education_streams (country_id, stream_code, name) VALUES ($1, 'bio', 'Bio-chimie') RETURNING id`,
    [country],
  )).rows[0].id;
  const streamLit = (await pool.query(
    `INSERT INTO education_streams (country_id, stream_code, name) VALUES ($1, 'lit', 'Littérature') RETURNING id`,
    [country],
  )).rows[0].id;
  const groupA = (await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name) VALUES ($1, 'A', 'A') RETURNING id`,
    [country],
  )).rows[0].id;
  const groupB = (await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name) VALUES ($1, 'B', 'B') RETURNING id`,
    [country],
  )).rows[0].id;
  return { school, year, level, streamBio, streamLit, groupA, groupB };
}

async function insertClass(pool, ids, { classCode, streamId = null, groupId = null, name = "3ème" }) {
  const result = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, level_id, stream_id, group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, class_code, group_id, stream_id, name, status`,
    [ids.school, ids.year, classCode, name, ids.level, streamId, groupId],
  );
  return result.rows[0];
}

async function applyIndex(pool) {
  const db = createDbAdapter(pool);
  await assertClassesStructuralUniquenessPreflight(db);
  await pool.query(DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL);
  await pool.query(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP classesStructuralNullUniqueness.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await setupSchema(pool);
    const ids = await seed(pool);

    const keptA = await insertClass(pool, ids, {
      classCode: "CLS-NULL-A",
      streamId: ids.streamBio,
      groupId: null,
    });
    const keptB = await insertClass(pool, ids, {
      classCode: "CLS-NULL-B",
      streamId: ids.streamLit,
      groupId: null,
    });
    await applyIndex(pool);
    await applyIndex(pool);

    const after = await pool.query(
      `SELECT id, class_code, group_id, stream_id, name, status
       FROM classes
       WHERE class_code IN ('CLS-NULL-A', 'CLS-NULL-B')
       ORDER BY class_code`,
    );
    assert.equal(after.rowCount, 2);
    assert.equal(after.rows[0].id, keptA.id);
    assert.equal(after.rows[1].id, keptB.id);
    assert.equal(after.rows[0].group_id, null);
    assert.equal(after.rows[1].group_id, null);
    assert.equal(after.rows[0].name, keptA.name);
    assert.equal(after.rows[1].status, keptB.status);

    await assert.rejects(
      () => insertClass(pool, ids, { classCode: "CLS-DUP-NULL", streamId: ids.streamBio, groupId: null }),
      (error) => String(error.code) === "23505" && String(error.constraint) === CLASSES_STRUCTURAL_UNIQUE_INDEX,
    );

    await insertClass(pool, ids, { classCode: "CLS-STREAM-NULL-1", streamId: null, groupId: ids.groupA });
    await assert.rejects(
      () => insertClass(pool, ids, { classCode: "CLS-STREAM-NULL-2", streamId: null, groupId: ids.groupA }),
      (error) => String(error.code) === "23505",
    );

    const withA = await insertClass(pool, ids, {
      classCode: "CLS-GROUP-A",
      streamId: ids.streamBio,
      groupId: ids.groupA,
    });
    const withB = await insertClass(pool, ids, {
      classCode: "CLS-GROUP-B",
      streamId: ids.streamBio,
      groupId: ids.groupB,
    });
    assert.ok(withA.id);
    assert.ok(withB.id);

    await pool.query(DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL);
    await insertClass(pool, ids, { classCode: "CLS-COLLIDE-1", streamId: ids.streamLit, groupId: null });
    await insertClass(pool, ids, { classCode: "CLS-COLLIDE-2", streamId: ids.streamLit, groupId: null });
    const dupCount = await pool.query(COUNT_CLASSES_STRUCTURAL_DUPLICATE_GROUPS_SQL);
    assert.equal(Number(dupCount.rows[0].duplicate_groups), 1);
    await assert.rejects(
      () => assertClassesStructuralUniquenessPreflight(createDbAdapter(pool)),
      (error) => error.code === CLASSES_STRUCTURAL_DUPLICATE_ERROR,
    );
    const stillThere = await pool.query(
      `SELECT COUNT(*)::int AS n FROM classes WHERE class_code IN ('CLS-COLLIDE-1', 'CLS-COLLIDE-2')`,
    );
    assert.equal(Number(stillThere.rows[0].n), 2);
    await assert.rejects(
      () => pool.query(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL),
      (error) => String(error.code) === "23505",
    );

    console.log("classesStructuralNullUniqueness.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
