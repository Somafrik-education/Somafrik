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

    CREATE TABLE IF NOT EXISTS enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES classes(id),
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);

  await pool.query("TRUNCATE enrollments, classes, academic_years, schools, countries CASCADE");
  await pool.query(NORMALIZE_CLASSES_STATUS_SQL);
  await pool.query(CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL);
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
    await setupFixture(pool);
    const repo = createClassesRepository(createDbAdapter(pool));

    const created = await repo.create(
      {
        name: "6ème A",
        academicYearName: "2025-2026",
        level: "6ème",
        section: "A",
        status: "active",
      },
      "SCH-A",
    );
    assert.equal(created.name, "6ème A");
    assert.equal(created.status, "active");
    assert.match(created.classCode, /^CLS-/);

    const listed = await repo.listBySchoolCode("SCH-A");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].classCode, created.classCode);

    const updated = await repo.update(created.classCode, "SCH-A", {
      name: "6ème A Persistée",
      status: "inactive",
    });
    assert.equal(updated.name, "6ème A Persistée");
    assert.equal(updated.status, "inactive");

    const reread = await repo.listBySchoolCode("SCH-A");
    assert.equal(reread[0].name, "6ème A Persistée");
    assert.equal(reread[0].status, "inactive");

    await assert.rejects(
      () =>
        repo.create(
          {
            name: " 6ème a persistée ",
            academicYearName: "2025-2026",
            status: "active",
          },
          "SCH-A",
        ),
      (error) => error.statusCode === 409,
    );

    const concurrentName = `Concurrent ${Date.now()}`;
    const results = await Promise.allSettled([
      repo.create(
        { name: concurrentName, academicYearName: "2025-2026", status: "active" },
        "SCH-A",
      ),
      repo.create(
        { name: concurrentName, academicYearName: "2025-2026", status: "active" },
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
        name: "6ème A Persistée",
        academicYearName: "2025-2026",
        status: "active",
      },
      "SCH-B",
    );
    assert.equal(inOtherSchool.schoolCode, "SCH-B");

    const listB = await repo.listBySchoolCode("SCH-B");
    assert.equal(listB.length, 1);
    assert.equal(listB[0].classCode, inOtherSchool.classCode);
    assert.ok(!listB.some((row) => row.classCode === created.classCode));

    await assert.rejects(
      () => repo.update(created.classCode, "SCH-B", { name: "Leak" }),
      (error) => error.statusCode === 404,
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
