/**
 * Répare le compte superadmin dans PostgreSQL + backoffice_state.
 * Appelé via npm run preprod:repair-superadmin (dans le conteneur backend).
 */
const { Pool } = require("pg");
const { syncSuperadminCredentials } = require("../lib/superadminBootstrap");

async function main() {
  if (process.env.SOMAFRIK_REPAIR_SUPERADMIN !== "true") {
    console.error("Réparation non autorisée hors contexte preprod:repair-superadmin.");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL manquant.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const creds = await syncSuperadminCredentials(pool);
    console.log("Compte superadmin synchronisé.");
    console.log(`  Identifiant : ${creds.identifier}`);
    console.log(`  Email       : ${creds.email}`);
    console.log(`  Code        : ${creds.userCode}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Échec réparation superadmin :", error.message);
  process.exit(1);
});
