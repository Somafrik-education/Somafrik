"use strict";

/**
 * P0-1 — Bascule is_current atomique :
 * transaction unique, FOR UPDATE des années de l'école, rollback si échec après clear,
 * concurrence : exactement une année courante.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ACADEMIC_YEARS_IT_DATABASE ?? "somafrik_academic_years_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
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

async function resetSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE countries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      iso_code VARCHAR(8) NOT NULL UNIQUE,
      phone_code VARCHAR(16) NOT NULL DEFAULT '+000',
      currency VARCHAR(16) NOT NULL DEFAULT 'XOF'
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
      start_date DATE,
      end_date DATE,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (school_id, name)
    );
  `);
}

async function seedYears(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, 'CD-2026-AY01', 'CD-LA-26-001', 'Lycée Atomic', 'active')
     RETURNING id, school_code, login_code`,
    [country.rows[0].id],
  );
  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2024-2025', '2024-09-01', '2025-08-31', TRUE, 'open')
     RETURNING id, is_current`,
    [school.rows[0].id],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', FALSE, 'open')
     RETURNING id, is_current`,
    [school.rows[0].id],
  );
  return {
    schoolId: school.rows[0].id,
    schoolCode: school.rows[0].login_code,
    yearAId: yearA.rows[0].id,
    yearBId: yearB.rows[0].id,
  };
}

function createReadyRepo(connectionString) {
  const repo = new PostgresRepository(connectionString);
  repo.ready = true;
  return repo;
}

function installFailAfterClear(repo) {
  const original = repo.createTxScope.bind(repo);
  repo.createTxScope = (tx) => {
    const scoped = original(tx);
    const rawQuery = scoped.query.bind(scoped);
    return new Proxy(scoped, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return async (sql, params) => {
            const result = await rawQuery(sql, params);
            if (/is_current\s*=\s*FALSE/i.test(String(sql))) {
              throw new Error("forced after clear");
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") return value.bind(receiver);
        return value;
      },
    });
  };
}

async function currentFlags(pool, schoolId) {
  const rows = await pool.query(
    `SELECT name, is_current FROM academic_years WHERE school_id = $1 ORDER BY name`,
    [schoolId],
  );
  return Object.fromEntries(rows.rows.map((row) => [row.name, row.is_current]));
}

async function main() {
  if (!DATABASE_URL) {
    console.log("academicYearsCurrentSwitch.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  const repos = [];
  try {
    await resetSchema(pool);
    const fixture = await seedYears(pool);

    const rollbackRepo = createReadyRepo(isolatedUrl);
    repos.push(rollbackRepo);
    installFailAfterClear(rollbackRepo);
    await assert.rejects(
      () => rollbackRepo.updateAcademicYearV2(fixture.yearBId, { isCurrent: true }),
      (error) => String(error.message) === "forced after clear",
    );
    const afterRollback = await currentFlags(pool, fixture.schoolId);
    assert.equal(afterRollback["2024-2025"], true, "A reste current après rollback");
    assert.equal(afterRollback["2025-2026"], false, "B reste false après rollback");

    const concurrentA = createReadyRepo(isolatedUrl);
    const concurrentB = createReadyRepo(isolatedUrl);
    repos.push(concurrentA, concurrentB);
    const settled = await Promise.allSettled([
      concurrentA.updateAcademicYearV2(fixture.yearAId, { isCurrent: true }),
      concurrentB.updateAcademicYearV2(fixture.yearBId, { isCurrent: true }),
    ]);
    assert.equal(
      settled.filter((item) => item.status === "rejected").length,
      0,
      `aucune erreur concurrence: ${JSON.stringify(settled.filter((item) => item.status === "rejected"))}`,
    );
    const afterConcurrent = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE is_current)::int AS current_count
       FROM academic_years WHERE school_id = $1`,
      [fixture.schoolId],
    );
    assert.equal(afterConcurrent.rows[0].current_count, 1, "exactement une année courante après PATCH simultanés");

    console.log("academicYearsCurrentSwitch.pg.test.js: OK");
  } finally {
    await Promise.all(repos.map((repo) => repo.close().catch(() => undefined)));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
