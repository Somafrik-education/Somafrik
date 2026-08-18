"use strict";

/**
 * Inventaire Planning V2 — classification des lignes datées.
 * Aucun INSERT. STOP si SOMAFRIK_PLANNING_WEEKLY_BACKFILL=1.
 *
 * Usage : node backend/scripts/inventory-planning-weekly-preflight.js
 */
const { Pool } = require("pg");
const {
  inventoryPlanningWeeklyLegacy,
  assertPlanningWeeklyNoAutomaticBackfill,
  formatPlanningWeeklyPreflightLog,
} = require("../lib/planningWeeklyMigrationPreflight");

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    console.log("inventory-planning-weekly-preflight: SKIP (DATABASE_URL absent)");
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = {
    async one(sql, params) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
  };

  try {
    const report = await inventoryPlanningWeeklyLegacy(db);
    console.log(formatPlanningWeeklyPreflightLog(report));
    console.log(JSON.stringify({ summary: report.summary, legacyCount: report.legacyCount, skipped: report.skipped }, null, 2));
    assertPlanningWeeklyNoAutomaticBackfill(report);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
