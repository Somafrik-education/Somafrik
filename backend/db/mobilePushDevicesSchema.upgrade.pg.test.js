"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { applyMobilePushDevicesSchema } = require("./clientsCanonicalBootstrap");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PUSH_N1_UPGRADE_IT_DATABASE ?? "somafrik_push_n1_upgrade_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const LEGACY_TOKEN = "ExponentPushToken[legacy-preview]";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function columnNames(pool, table) {
  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY column_name`,
    [table],
  );
  return columns.rows.map((row) => row.column_name);
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour mobilePushDevicesSchema.upgrade.pg.test.js");
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        user_code TEXT
      )
    `);
    await pool.query(`
      CREATE TABLE mobile_push_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        school_id UUID,
        expo_push_token TEXT NOT NULL,
        platform TEXT NOT NULL,
        release_profile TEXT NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT mobile_push_devices_release_profile_check
          CHECK (release_profile IN ('development', 'preview', 'preproduction', 'production')),
        CONSTRAINT mobile_push_devices_token_unique UNIQUE (expo_push_token)
      )
    `);
    const userId = randomUUID();
    await pool.query(`INSERT INTO users (id, user_code) VALUES ($1, 'PUSH-LEGACY')`, [userId]);
    const inserted = await pool.query(
      `INSERT INTO mobile_push_devices (user_id, expo_push_token, platform, release_profile)
       VALUES ($1, $2, 'android', 'preview')
       RETURNING id, expo_push_token, release_profile`,
      [userId, LEGACY_TOKEN],
    );
    const deviceId = inserted.rows[0].id;
    const before = await columnNames(pool, "mobile_push_devices");
    assert.ok(before.includes("release_profile"));
    assert.equal(before.includes("app_profile"), false);
    assert.equal(before.includes("backend_environment"), false);

    await applyMobilePushDevicesSchema(pool);
    await applyMobilePushDevicesSchema(pool);

    const names = await columnNames(pool, "mobile_push_devices");
    assert.ok(names.includes("backend_environment"), names.join(","));
    assert.ok(names.includes("app_profile"), names.join(","));
    assert.equal(names.includes("release_profile"), false, "release_profile doit être retiré");

    const row = await pool.query(
      `SELECT id, expo_push_token, backend_environment, app_profile
       FROM mobile_push_devices WHERE expo_push_token = $1`,
      [LEGACY_TOKEN],
    );
    assert.equal(row.rowCount, 1, "aucune perte de token");
    assert.equal(row.rows[0].id, deviceId);
    assert.equal(row.rows[0].expo_push_token, LEGACY_TOKEN);
    assert.equal(row.rows[0].backend_environment, "preproduction");
    assert.equal(row.rows[0].app_profile, "preview");
    console.log("mobilePushDevicesSchema.upgrade.pg.test.js GO — bootstrap ×2 idempotent");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
