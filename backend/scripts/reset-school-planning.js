/**
 * Réinitialise le calendrier / planning (créneaux, affectations, examens planifiés).
 *
 * Usage :
 *   node backend/scripts/reset-school-planning.js
 *   node backend/scripts/reset-school-planning.js --school=CD-2026-0001
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function resetPlanningInState(state, schoolCode) {
  const next = { ...state };
  const matchSchool = (row) => normalize(row?.schoolCode) === normalize(schoolCode);

  if (schoolCode) {
    next.courseSchedules = (state.courseSchedules ?? []).filter((row) => !matchSchool(row));
    next.assignments = (state.assignments ?? []).filter((row) => !matchSchool(row));
    next.exams = (state.exams ?? []).filter((row) => !matchSchool(row));
  } else {
    next.courseSchedules = [];
    next.assignments = [];
    next.exams = [];
  }

  if (next.deletedRows) {
    const deleted = { ...next.deletedRows };
    delete deleted.courseSchedules;
    delete deleted.assignments;
    delete deleted.exams;
    next.deletedRows = deleted;
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

async function loadBackOfficeState(client) {
  const result = await client.query(
    "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
  );
  return result.rows[0]?.state_payload ?? null;
}

async function saveBackOfficeState(client, payload) {
  await client.query(
    `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
     VALUES ('default', $1::jsonb, NOW())
     ON CONFLICT (state_key) DO UPDATE SET
       state_payload = EXCLUDED.state_payload,
       updated_at = NOW()`,
    [JSON.stringify(payload)],
  );
}

async function main() {
  const schoolArg = process.argv.find((arg) => arg.startsWith("--school="));
  const schoolCode = schoolArg ? schoolArg.split("=")[1]?.trim() : "";

  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const current = await loadBackOfficeState(client);
    if (!current) {
      throw new Error("backoffice_state introuvable.");
    }

    const before = {
      slots: (current.courseSchedules ?? []).length,
      assignments: (current.assignments ?? []).length,
      exams: (current.exams ?? []).length,
    };

    const next = resetPlanningInState(current, schoolCode);

    await saveBackOfficeState(client, next);
    await client.query("COMMIT");

    const after = {
      slots: (next.courseSchedules ?? []).length,
      assignments: (next.assignments ?? []).length,
      exams: (next.exams ?? []).length,
    };

    console.log(
      schoolCode
        ? `Planning réinitialisé pour l'établissement ${schoolCode}.`
        : "Planning réinitialisé pour tous les établissements.",
    );
    console.log(`  Créneaux : ${before.slots} → ${after.slots}`);
    console.log(`  Affectations : ${before.assignments} → ${after.assignments}`);
    console.log(`  Examens : ${before.exams} → ${after.exams}`);
    console.log("Rechargez l'application et planifiez depuis Planning de cours.");
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
