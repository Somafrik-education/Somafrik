"use strict";

/**
 * Intégration PostgreSQL réelle — Classes :
 * create/read, update persistée, unicité (dont concurrente),
 * isolation inter-établissements, contrainte active|inactive.
 *
 * Prérequis : DATABASE_URL fourni par l'environnement CI (aucun secret/URI de secours).
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createClassesRepository } = require("../db/classesRepository");
const {
  CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
  CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  ENSURE_CLASSES_STATUS_CHECK_SQL,
  NORMALIZE_CLASSES_STATUS_SQL,
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
} = require("./classesUniqueness");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const CLASSES_IT_DATABASE = String(process.env.SOMAFRIK_CLASSES_IT_DATABASE ?? "somafrik_classes_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

/**
 * Dérive une URI vers une base isolée à partir de DATABASE_URL (env CI uniquement).
 * @param {string} databaseUrl
 * @param {string} databaseName
 */
function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/**
 * Crée la base d'intégration si absente (utilisateur CI = owner du cluster local).
 * @param {string} databaseUrl
 * @param {string} databaseName
 */
async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) {
    throw new Error("SOMAFRIK_CLASSES_IT_DATABASE invalide.");
  }
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
      logo_url TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      school_type TEXT DEFAULT 'Établissement',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
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
      level TEXT,
      section TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS education_levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      level_code TEXT NOT NULL,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS education_streams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      level_id UUID REFERENCES education_levels(id),
      stream_code TEXT NOT NULL,
      name TEXT NOT NULL,
      stream_type TEXT NOT NULL DEFAULT 'filiere',
      display_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS school_levels (
      school_id UUID NOT NULL REFERENCES schools(id),
      level_id UUID NOT NULL REFERENCES education_levels(id),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (school_id, level_id)
    );

    CREATE TABLE IF NOT EXISTS school_streams (
      school_id UUID NOT NULL REFERENCES schools(id),
      stream_id UUID NOT NULL REFERENCES education_streams(id),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (school_id, stream_id)
    );

    CREATE TABLE IF NOT EXISTS education_class_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      group_code TEXT NOT NULL,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS school_class_groups (
      school_id UUID NOT NULL REFERENCES schools(id),
      group_id UUID NOT NULL REFERENCES education_class_groups(id),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (school_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES classes(id),
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);

  await pool.query(`
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES education_levels(id);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS stream_id UUID REFERENCES education_streams(id);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES education_class_groups(id);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_code TEXT;
  `);

  await pool.query("TRUNCATE enrollments, classes, school_class_groups, school_streams, school_levels, education_class_groups, education_streams, education_levels, academic_years, schools, countries CASCADE");
  await pool.query(NORMALIZE_CLASSES_STATUS_SQL);
  await pool.query(CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL);
  await pool.query(DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL);
  await pool.query(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL);
  await pool.query(ENSURE_CLASSES_STATUS_CHECK_SQL);

  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('Testland', 'TT', '+000', 'XOF')
     RETURNING id`,
  );
  const countryId = country.rows[0].id;

  await pool.query(
    `INSERT INTO schools (country_id, school_code, name)
     VALUES ($1, 'SCH-A', 'École A'), ($1, 'SCH-B', 'École B')`,
    [countryId],
  );

  await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     SELECT id, '2025-2026', TRUE, 'open' FROM schools WHERE school_code IN ('SCH-A', 'SCH-B')`,
  );

  const levelA = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '6eme', '6ème', 'active') RETURNING id`,
    [countryId],
  );
  const levelB = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '5eme', '5ème', 'active') RETURNING id`,
    [countryId],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status)
     SELECT s.id, $1, 'active' FROM schools s WHERE s.school_code = 'SCH-A'`,
    [levelA.rows[0].id],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status)
     SELECT s.id, $1, 'active' FROM schools s WHERE s.school_code = 'SCH-B'`,
    [levelB.rows[0].id],
  );

  const groupA = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'A', 'A', 'active') RETURNING id`,
    [countryId],
  );
  const groupC = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'C', 'C', 'active') RETURNING id`,
    [countryId],
  );
  await pool.query(
    `INSERT INTO school_class_groups (school_id, group_id, status)
     SELECT s.id, $1, 'active' FROM schools s WHERE s.school_code IN ('SCH-A', 'SCH-B')`,
    [groupA.rows[0].id],
  );
  await pool.query(
    `INSERT INTO school_class_groups (school_id, group_id, status)
     SELECT s.id, $1, 'active' FROM schools s WHERE s.school_code = 'SCH-A'`,
    [groupC.rows[0].id],
  );

  return {
    yearA: (
      await pool.query(
        `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-A'`,
      )
    ).rows[0].id,
    yearB: (
      await pool.query(
        `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-B'`,
      )
    ).rows[0].id,
    levelA: levelA.rows[0].id,
    levelB: levelB.rows[0].id,
    groupA: groupA.rows[0].id,
    groupC: groupC.rows[0].id,
  };
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
        `SELECT id, school_code, country_id FROM schools WHERE school_code = $1 LIMIT 1`,
        [String(code ?? "").trim().toUpperCase()],
      );
      return result.rows[0] ?? null;
    },
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP classesRepository.pg.test.js: DATABASE_URL absent");
    return;
  }

  assert.equal(
    isClassNameUniquenessViolation({
      code: "23505",
      constraint: "uq_classes_school_year_normalized_name",
    }),
    true,
  );
  assert.equal(
    isClassCodeUniquenessViolation({
      code: "23505",
      constraint: "uq_classes_school_year_normalized_name",
    }),
    false,
  );
  assert.equal(
    isClassCodeUniquenessViolation({
      code: "23505",
      constraint: "classes_class_code_key",
      detail: "Key (class_code)=(CLS-1) already exists.",
    }),
    true,
  );

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, CLASSES_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    const ids = await setupFixture(pool);
    const repo = createClassesRepository(createDbAdapter(pool));

    const created = await repo.create(
      {
        academicYearId: ids.yearA,
        levelId: ids.levelA,
        groupId: ids.groupA,
        status: "active",
      },
      "SCH-A",
    );
    assert.equal(created.name, "6ème");
    assert.equal(created.status, "active");
    assert.equal(created.groupCode, "A");
    assert.match(created.classCode, /^CLS-/);

    const listed = await repo.listBySchoolCode("SCH-A");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].classCode, created.classCode);

    const updated = await repo.update(created.classCode, "SCH-A", {
      status: "inactive",
    });
    assert.equal(updated.status, "inactive");
    assert.equal(updated.name, "6ème");

    const reread = await repo.listBySchoolCode("SCH-A");
    assert.equal(reread[0].name, "6ème");
    assert.equal(reread[0].status, "inactive");

    await assert.rejects(
      () =>
        repo.create(
          {
            academicYearId: ids.yearA,
            levelId: ids.levelA,
            groupId: ids.groupA,
            status: "active",
          },
          "SCH-A",
        ),
      (error) => error.statusCode === 409,
    );

    const results = await Promise.allSettled([
      repo.create(
        { academicYearId: ids.yearA, levelId: ids.levelA, groupId: ids.groupC, status: "active" },
        "SCH-A",
      ),
      repo.create(
        { academicYearId: ids.yearA, levelId: ids.levelA, groupId: ids.groupC, status: "active" },
        "SCH-A",
      ),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactement une création concurrente doit réussir");
    assert.equal(rejected.length, 1, "exactement une création concurrente doit échouer");
    assert.equal(rejected[0].reason.statusCode, 409);

    const inOtherSchool = await repo.create(
      {
        academicYearId: ids.yearB,
        levelId: ids.levelB,
        groupId: ids.groupA,
        status: "active",
      },
      "SCH-B",
    );
    assert.equal(inOtherSchool.schoolCode, "SCH-B");
    assert.equal(inOtherSchool.name, "5ème");

    const listB = await repo.listBySchoolCode("SCH-B");
    assert.equal(listB.length, 1);
    assert.equal(listB[0].classCode, inOtherSchool.classCode);
    assert.ok(!listB.some((row) => row.classCode === created.classCode));

    await assert.rejects(
      () => repo.update(created.classCode, "SCH-B", { status: "active" }),
      (error) => error.statusCode === 404,
    );

    await assert.rejects(
      () =>
        repo.create(
          { name: "Inventé", academicYearName: "2025-2026", level: "X" },
          "SCH-A",
        ),
      (error) => error.statusCode === 400,
    );

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
           SELECT s.id, ay.id, $1, 'Statut Invalide', 'archived'
           FROM schools s
           JOIN academic_years ay ON ay.school_id = s.id
           WHERE s.school_code = 'SCH-A'
           LIMIT 1`,
          [`CLS-BAD-STATUS-${Date.now()}`],
        ),
      (error) => String(error.code) === "23514",
    );

    console.log("classesRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
