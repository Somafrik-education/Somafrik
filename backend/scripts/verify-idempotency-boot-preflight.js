"use strict";

/**
 * Régression Render #274 : une base préexistante possède l'ancienne table
 * idempotency_keys sans school_scope/request_hash. Le préflight doit ajouter
 * les colonnes AVANT schema.sql, afin que les CREATE INDEX ne lèvent pas 42703.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { resolveDatabaseConfig } = require("../db/connectionConfig");
const { ensureIdempotencyBootColumns } = require("./prestart-idempotency-schema");

const REQUIRED =
  String(process.env.CI ?? "").toLowerCase() === "true" ||
  String(process.env.SOMAFRIK_BOOTSTRAP_REQUIRED ?? "").toLowerCase() === "true";

async function main() {
  let config;
  try {
    config = resolveDatabaseConfig(process.env).poolConfig;
  } catch (error) {
    if (REQUIRED) throw error;
    console.log("SKIP verify:idempotency-boot-preflight — PostgreSQL absent");
    return;
  }

  const pool = new Pool(config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Simule exactement la table legacy qui a fait tomber Render.
    await client.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        cache_id TEXT PRIMARY KEY,
        route_key TEXT NOT NULL,
        principal_id TEXT NOT NULL DEFAULT '',
        status_code INTEGER NOT NULL,
        response_body JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS school_scope CASCADE");
    await client.query("ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS request_hash CASCADE");

    const before = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'idempotency_keys'
        AND column_name IN ('school_scope', 'request_hash')
    `);
    assert.equal(before.rowCount, 0, "fixture legacy : colonnes LOT 5 absentes");

    await ensureIdempotencyBootColumns(client);

    const after = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'idempotency_keys'
        AND column_name IN ('school_scope', 'request_hash')
      ORDER BY column_name
    `);
    assert.deepEqual(
      after.rows.map((row) => row.column_name),
      ["request_hash", "school_scope"],
      "préflight ajoute les deux colonnes canoniques",
    );

    // Exécute le vrai schema.sql : c'est précisément ici que Render levait 42703.
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await client.query(schema);

    const indexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'idempotency_keys'
        AND indexname IN ('idx_idempotency_school_scope', 'idx_idempotency_principal_route')
      ORDER BY indexname
    `);
    assert.deepEqual(
      indexes.rows.map((row) => row.indexname),
      ["idx_idempotency_principal_route", "idx_idempotency_school_scope"],
      "schema.sql peut créer les index après préflight",
    );

    console.log("OK idempotency legacy schema → preflight → schema.sql (pas de 42703)");
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error("FAIL verify:idempotency-boot-preflight:", error?.message || error);
  if (error?.code) console.error("Code domaine:", error.code);
  process.exit(1);
});
