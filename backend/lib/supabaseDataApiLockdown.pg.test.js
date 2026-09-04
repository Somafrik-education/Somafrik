"use strict";

/**
 * P0-1 — preuves PostgreSQL : anon/authenticated → permission denied
 * sur les tables métier ; le rôle applicatif (owner) reste opérationnel.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SUPABASE_DATA_API_LOCKDOWN_SQL,
  SENSITIVE_BUSINESS_TABLES,
  applySupabaseDataApiLockdown,
  listSensitiveDataApiGrants,
  EXPOSED_FUNCTION_INVENTORY_SQL,
  EXPOSED_VIEW_INVENTORY_SQL,
} = require("../db/supabaseDataApiLockdown");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_P0_DATA_API_IT_DATABASE ?? "somafrik_p0_data_api_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function loadPgPool() {
  try {
    return require("pg").Pool;
  } catch {
    return null;
  }
}

async function ensureDatabase(Pool, databaseUrl, databaseName) {
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

function isPermissionDenied(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42501" || message.includes("permission denied") || message.includes("must be owner");
}

async function main() {
  if (!DATABASE_URL) {
    console.log("supabaseDataApiLockdown.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const Pool = loadPgPool();
  if (!Pool) {
    console.log("supabaseDataApiLockdown.pg.test.js SKIP (pg absent)");
    return;
  }

  const isolatedUrl = await ensureDatabase(Pool, DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO CURRENT_USER");
    await pool.query(
      fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"),
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT
      );
      CREATE TABLE IF NOT EXISTS mobile_push_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        token TEXT
      );
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
        END IF;
      END $$;
    `);

    await pool.query("GRANT USAGE ON SCHEMA public TO anon, authenticated, PUBLIC");
    await pool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, PUBLIC");

    await pool.query("GRANT anon, authenticated, service_role TO CURRENT_USER");

    const before = await listSensitiveDataApiGrants(pool);
    assert.ok(before.length > 0, "le scénario vulnérable doit exposer des grants anon/PUBLIC");

    assert.match(SUPABASE_DATA_API_LOCKDOWN_SQL, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC/);
    await applySupabaseDataApiLockdown(pool);

    const after = await listSensitiveDataApiGrants(pool);
    assert.deepEqual(
      after,
      [],
      `grants résiduels anon/authenticated/PUBLIC: ${JSON.stringify(after)}`,
    );

    const present = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [SENSITIVE_BUSINESS_TABLES],
    );
    const presentNames = present.rows.map((row) => row.table_name);

    for (const role of ["anon", "authenticated"]) {
      for (const table of presentNames) {
        let denied = false;
        try {
          await pool.query(`SET ROLE ${role}`);
          await pool.query(`SELECT * FROM ${table} LIMIT 1`);
        } catch (error) {
          denied = isPermissionDenied(error);
          if (!denied) throw error;
        } finally {
          await pool.query("RESET ROLE");
        }
        assert.equal(denied, true, `${role} SELECT ${table} doit être permission denied`);
      }
    }

    for (const table of presentNames) {
      await pool.query(`SELECT * FROM ${table} LIMIT 1`);
    }

    await pool.query("SET ROLE service_role");
    try {
      await pool.query("SELECT * FROM users LIMIT 1");
    } finally {
      await pool.query("RESET ROLE");
    }

    const functions = await pool.query(EXPOSED_FUNCTION_INVENTORY_SQL);
    const definer = (functions.rows ?? []).filter((row) => row.security === "SECURITY DEFINER");
    const views = await pool.query(EXPOSED_VIEW_INVENTORY_SQL);

    console.log(
      JSON.stringify(
        {
          sensitiveTablesProbed: presentNames,
          residualGrants: after.length,
          securityDefinerFunctions: definer.map((row) => row.function_name),
          views: (views.rows ?? []).map((row) => row.view_name),
        },
        null,
        2,
      ),
    );
    console.log("supabaseDataApiLockdown.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
