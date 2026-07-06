/**
 * Supprime les doublons dans backoffice_state (PostgreSQL).
 *
 * Usage :
 *   node backend/scripts/dedupe-backoffice-state.js
 *   docker compose restart backend
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { dedupeBackOfficeState } = require("../lib/backofficeDedupe");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function countEntity(state, key) {
  return Array.isArray(state[key]) ? state[key].length : 0;
}

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    const current = result.rows[0]?.state_payload;
    if (!current) {
      console.log("Aucun état backoffice_state à dédoublonner.");
      return;
    }

    const before = {
      contacts: countEntity(current, "contacts"),
      relations: countEntity(current, "relations"),
      students: countEntity(current, "students"),
      teachers: countEntity(current, "teachers"),
      classes: countEntity(current, "classes"),
      courses: countEntity(current, "courses"),
      assignments: countEntity(current, "assignments"),
      courseSchedules: countEntity(current, "courseSchedules"),
      notes: countEntity(current, "notes"),
      bulletins: countEntity(current, "bulletins"),
    };

    const { state: next, report } = dedupeBackOfficeState(current);

    await client.query(
      `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
       VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
      [JSON.stringify(next)],
    );

    await client.query("COMMIT");

    const after = {
      contacts: countEntity(next, "contacts"),
      relations: countEntity(next, "relations"),
      students: countEntity(next, "students"),
      teachers: countEntity(next, "teachers"),
      classes: countEntity(next, "classes"),
      courses: countEntity(next, "courses"),
      assignments: countEntity(next, "assignments"),
      courseSchedules: countEntity(next, "courseSchedules"),
      notes: countEntity(next, "notes"),
      bulletins: countEntity(next, "bulletins"),
    };

    console.log("Dédoublonnage terminé.");
    console.log(`  Doublons supprimés : ${report.totalRemoved}`);
    if (Object.keys(report.byEntity).length) {
      console.log("  Détail :");
      Object.entries(report.byEntity)
        .sort((a, b) => b[1] - a[1])
        .forEach(([entity, count]) => console.log(`    - ${entity}: ${count}`));
    }
    if (report.deletedRowsCleared.length) {
      console.log(`  deletedRows nettoyés : ${report.deletedRowsCleared.join(", ")}`);
    }
    console.log("");
    console.log("  Avant → Après");
    Object.keys(before).forEach((key) => {
      if (before[key] !== after[key]) {
        console.log(`    ${key}: ${before[key]} → ${after[key]}`);
      }
    });
    console.log("");
    console.log("Redémarrez le backend : docker compose restart backend");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
