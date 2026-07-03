/**
 * Répare un état BackOffice corrompu (ex. deletedRows massifs après PUT partiel).
 * Supprime l'instantané JSON persistant : l'API reconstruit alors l'état depuis PostgreSQL.
 *
 * Usage :
 *   node backend/scripts/repair-backoffice-state.js
 *   docker compose restart backend
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  try {
    const before = await pool.query(
      "SELECT state_payload FROM backoffice_state WHERE state_key = 'default'",
    );
    const payload = before.rows[0]?.state_payload ?? null;
    if (payload) {
      const schools = Array.isArray(payload.schools) ? payload.schools.length : 0;
      const users = Array.isArray(payload.users) ? payload.users.length : 0;
      const deletedSchools = Array.isArray(payload.deletedRows?.schools)
        ? payload.deletedRows.schools.length
        : 0;
      const deletedUsers = Array.isArray(payload.deletedRows?.users)
        ? payload.deletedRows.users.length
        : 0;
      console.log(
        `État actuel : ${schools} école(s), ${users} utilisateur(s) — deletedRows: ${deletedSchools} écoles, ${deletedUsers} comptes.`,
      );
    } else {
      console.log("Aucun instantané backoffice_state à réparer.");
      return;
    }

    await pool.query("DELETE FROM backoffice_state WHERE state_key = 'default'");
    console.log("Instantané backoffice_state supprimé.");
    console.log("Redémarrez le backend : docker compose restart backend");
    console.log("Puis reconnectez-vous (superadmin / 1234) sur http://localhost:5173/web/connexion");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
