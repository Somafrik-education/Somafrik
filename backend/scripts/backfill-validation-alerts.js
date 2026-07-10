/**
 * Génère rétroactivement les alertes Super Admin pour les comptes /
 * établissements déjà « En attente de validation » sans notification.
 *
 * Usage :
 *   docker compose exec -T backend node scripts/backfill-validation-alerts.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { initializeRepository } = require("../db/repositoryFactory");
const { enrichStateWithValidationAlerts } = require("../lib/validationNotifications");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function countPending(users = [], schools = []) {
  const pendingUsers = users.filter(
    (user) =>
      user.role === "Admin School" &&
      (user.validationStatus === "En attente de validation" || user.status === "En attente de validation"),
  );
  const pendingSchools = schools.filter(
    (school) =>
      school.validationStatus === "En attente de validation" ||
      school.status === "En attente" ||
      school.status === "En attente de validation",
  );
  return { pendingUsers, pendingSchools };
}

async function main() {
  const { repository } = await initializeRepository();
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });

  try {
    const current = (await repository.getBackOfficeState()) ?? {};
    const beforeCount = (current.notifications ?? []).length;
    const { pendingUsers, pendingSchools } = countPending(current.users, current.schools);

    if (!pendingUsers.length && !pendingSchools.length) {
      console.log("Aucun compte ou établissement en attente de validation.");
      return;
    }

    const enriched = enrichStateWithValidationAlerts(current, current, null);
    const added = (enriched.notifications ?? []).length - beforeCount;

    if (added <= 0) {
      console.log("Les alertes existent déjà pour tous les éléments en attente.");
      console.log(`  Comptes en attente : ${pendingUsers.length}`);
      console.log(`  Établissements en attente : ${pendingSchools.length}`);
      return;
    }

    await pool.query(
      `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
       VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (state_key) DO UPDATE SET
         state_payload = EXCLUDED.state_payload,
         updated_at = NOW()`,
      [JSON.stringify(enriched)],
    );

    console.log("Alertes de validation générées.");
    console.log(`  Comptes Admin École en attente : ${pendingUsers.length}`);
    for (const user of pendingUsers) {
      const label = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.identifier;
      console.log(`    - ${label} (${user.identifier ?? user.id})`);
    }
    console.log(`  Établissements en attente : ${pendingSchools.length}`);
    for (const school of pendingSchools) {
      console.log(`    - ${school.name ?? school.code} (${school.code})`);
    }
    console.log(`  Nouvelles notifications : ${added}`);
    console.log("");
    console.log("Redémarrez le backend : docker compose restart backend");
  } finally {
    await repository.close?.();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
