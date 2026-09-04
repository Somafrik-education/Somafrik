"use strict";

/**
 * Purge de rétention (sessions / push). Idempotente.
 * INTERDIT d'exécuter contre Somafrik-prod depuis Cursor.
 * Production : exiger SOMAFRIK_ALLOW_RETENTION_PURGE=true (GO ops).
 */

const { purgeRetention } = require("../lib/retentionPolicy");

async function main() {
  const env = process.env;
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production"
    && env.SOMAFRIK_ALLOW_RETENTION_PURGE !== "true") {
    console.error("Refusé : production sans SOMAFRIK_ALLOW_RETENTION_PURGE=true.");
    process.exit(2);
  }

  let repository;
  if (env.DATABASE_URL) {
    const { PostgresRepository } = require("../db/postgresRepository");
    repository = new PostgresRepository();
    await repository.init();
  } else {
    const { FallbackRepository } = require("../db/fallbackRepository");
    repository = new FallbackRepository();
  }

  try {
    const result = await purgeRetention(repository);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    if (typeof repository.close === "function") {
      await repository.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
