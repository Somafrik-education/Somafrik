/**
 * Ne conserve que N enseignants dans backoffice_state.
 *
 * Usage :
 *   node backend/scripts/trim-teachers.js
 *   node backend/scripts/trim-teachers.js --keep=15
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { trimTeachersState } = require("../lib/trimTeachers");
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

function parseKeepArg() {
  const arg = process.argv.find((value) => value.startsWith("--keep"));
  if (!arg) return 15;
  const [, raw] = arg.split("=");
  const parsed = Number(raw ?? process.argv[process.argv.indexOf(arg) + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

async function main() {
  const keep = parseKeepArg();
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    const current = result.rows[0]?.state_payload;
    if (!current) {
      console.log("Aucun état backoffice_state trouvé.");
      return;
    }

    const { state: trimmed, report } = trimTeachersState(current, { keep });
    const { state: next } = dedupeBackOfficeState(trimmed);

    await client.query(
      `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
       VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
      [JSON.stringify(next)],
    );

    await client.query("COMMIT");

    console.log(`Enseignants conservés : ${report.teachersAfter} / ${report.teachersBefore}`);
    console.log(`  Supprimés : ${report.removedTeachers}`);
    console.log(`  Affectations retirées : ${report.removedAssignments}`);
    if (report.removedUsers > 0) {
      console.log(`  Comptes utilisateurs enseignants retirés : ${report.removedUsers}`);
    }
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
