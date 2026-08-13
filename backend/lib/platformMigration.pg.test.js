"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { PLATFORM_SCHEMA_SQL } = require("../db/platformSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_PLATFORM_MIGRATION_IT_DATABASE ?? "somafrik_platform_migration_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

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

async function main() {
  if (!DATABASE_URL) {
    console.log("platformMigration.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(PLATFORM_SCHEMA_SQL);

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'role_permissions','dashboard_chart_config','subscription_offers',
           'subscription_payments','subscription_invoices','subscription_discounts','subscription_audit_log'
         )
       ORDER BY table_name`,
    );
    assert.equal(tables.rowCount, 7);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Test', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, profile_payload)
       VALUES ($1, 'Premium', 10, 'CDF', '{"offerId":"OFFER-1"}'::jsonb)`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO role_permissions (role_name, permissions)
       VALUES ('Admin School', '["Voir tableau de bord"]'::jsonb)`,
    );

    const roles = await pool.query(`SELECT permissions FROM role_permissions WHERE role_name = 'Admin School'`);
    assert.equal(roles.rows[0].permissions[0], "Voir tableau de bord");

    console.log("platformMigration.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
