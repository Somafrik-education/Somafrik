"use strict";

/**
 * Hotfix boot PostgreSQL après LOT 5.
 *
 * Une base existante peut déjà contenir `idempotency_keys` dans son ancien format.
 * `CREATE TABLE IF NOT EXISTS` ne rajoute pas les nouvelles colonnes ; or schema.sql
 * crée ensuite des index sur `school_scope` avant que PostgresRepository.init()
 * n'atteigne ensureIdempotencySchema().
 *
 * Ce préflight est volontairement minimal et non destructif : il ne crée aucune
 * donnée métier et ajoute uniquement les colonnes canoniques manquantes avant
 * l'exécution de schema.sql.
 */
const { Pool } = require("pg");
const { resolveDatabaseConfig } = require("../db/connectionConfig");

const PREFLIGHT_SQL = `
ALTER TABLE IF EXISTS idempotency_keys
  ADD COLUMN IF NOT EXISTS school_scope TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS idempotency_keys
  ADD COLUMN IF NOT EXISTS request_hash TEXT NOT NULL DEFAULT '';
`;

async function ensureIdempotencyBootColumns(pool) {
  await pool.query(PREFLIGHT_SQL);
}

async function main() {
  let resolved;
  try {
    resolved = resolveDatabaseConfig(process.env);
  } catch (error) {
    // Le contrat de configuration canonique reste sous l'autorité du runtime.
    // En dev/test sans PostgreSQL, le préflight ne doit pas inventer une DB.
    if (String(process.env.NODE_ENV ?? "").toLowerCase() !== "production" &&
        String(process.env.SOMAFRIK_DB_REQUIRED ?? "").toLowerCase() !== "true") {
      return;
    }
    throw error;
  }

  const pool = new Pool(resolved.poolConfig);
  try {
    await ensureIdempotencyBootColumns(pool);
    console.log("Préflight idempotency_keys OK");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Échec préflight idempotency_keys:", error?.message || error);
    if (error?.code) console.error("Code domaine:", error.code);
    process.exit(1);
  });
}

module.exports = {
  PREFLIGHT_SQL,
  ensureIdempotencyBootColumns,
};
