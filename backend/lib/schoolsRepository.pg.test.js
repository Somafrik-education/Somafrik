"use strict";

/**
 * Intégration PostgreSQL — établissements :
 * persist, relecture profil JSONB, mise à jour, isolation par code.
 *
 * Prérequis : DATABASE_URL fourni par l'environnement CI (aucun secret/URI de secours).
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createSchoolsRepository } = require("../db/schoolsRepository");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const SCHOOLS_IT_DATABASE = String(process.env.SOMAFRIK_SCHOOLS_IT_DATABASE ?? "somafrik_schools_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) {
    throw new Error("SOMAFRIK_SCHOOLS_IT_DATABASE invalide.");
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
      profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query("TRUNCATE schools, countries CASCADE");
  await pool.query(`
    INSERT INTO countries (name, iso_code, phone_code, currency, is_active)
    VALUES
      ('République Démocratique du Congo', 'CD', '+243', 'CDF', TRUE),
      ('République du Congo', 'CG', '+242', 'XAF', TRUE),
      ('Burundi', 'BI', '+257', 'BIF', TRUE)
  `);
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

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP schoolsRepository.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, SCHOOLS_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await setupFixture(pool);
    const repo = createSchoolsRepository(createDbAdapter(pool));

    const created = await repo.persist({
      code: "BI-2026-0401",
      name: "Collège Lot 1 PG",
      type: "Collège",
      country: "Burundi",
      countryCode: "BI",
      city: "Bujumbura",
      phone: "+257 00 00 00",
      email: "lot1pg@test.bi",
      principalName: "Jean Ndayishimiye",
      status: "En attente",
      validationStatus: "En attente de validation",
    });
    assert.equal(created.code, "BI-2026-0401");
    assert.equal(created.status, "En attente");
    assert.equal(created.principalName, "Jean Ndayishimiye");
    assert.equal(created.countryCode, "BI");

    const row = await pool.query("SELECT school_code, status, profile_payload FROM schools WHERE school_code = $1", [
      "BI-2026-0401",
    ]);
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].status, "pending");
    assert.equal(row.rows[0].profile_payload.principalName, "Jean Ndayishimiye");

    const updated = await repo.persist({
      ...created,
      name: "Collège Lot 1 PG Persisté",
      status: "Actif",
      validationStatus: "Validé",
    });
    assert.equal(updated.name, "Collège Lot 1 PG Persisté");
    assert.equal(updated.status, "Actif");

    const reread = await repo.getByCode("bi-2026-0401");
    assert.equal(reread.name, "Collège Lot 1 PG Persisté");
    assert.equal(reread.principalName, "Jean Ndayishimiye");

    const listed = await repo.listAll();
    assert.equal(listed.length, 1);

    await assert.rejects(
      () =>
        repo.persist({
          code: "FR-2026-0401",
          name: "Lycée Français Inventé",
          type: "Lycée",
          country: "France",
          countryCode: "FR",
          city: "Paris",
          status: "Actif",
        }),
      (error) => error.code === "COUNTRY_NOT_FOUND" && error.statusCode === 400,
    );

    const franceCountry = await pool.query("SELECT iso_code FROM countries WHERE iso_code = $1", ["FR"]);
    assert.equal(franceCountry.rows.length, 0, "aucun pays FR inventé");
    const franceSchool = await pool.query("SELECT school_code FROM schools WHERE school_code = $1", [
      "FR-2026-0401",
    ]);
    assert.equal(franceSchool.rows.length, 0, "aucun établissement FR persisté");
    const countryCount = await pool.query("SELECT COUNT(*)::int AS count FROM countries");
    assert.equal(countryCount.rows[0].count, 3);

    console.log("OK schoolsRepository PostgreSQL: persist / profil JSONB / update / pays inconnu refusé");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
