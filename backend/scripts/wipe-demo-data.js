/**
 * Supprime toutes les données de démonstration (PostgreSQL + état BackOffice).
 *
 * Usage :
 *   node backend/scripts/wipe-demo-data.js
 *   node backend/scripts/wipe-demo-data.js --bootstrap
 *
 * Variables utiles (.env) :
 *   DATABASE_URL ou POSTGRES_*
 *   SOMAFRIK_SKIP_DEMO_SEED=true   (empêche le re-seed au prochain démarrage)
 *   BOOTSTRAP_SUPERADMIN_ID=superadmin
 *   BOOTSTRAP_SUPERADMIN_PASSWORD=...
 */
const path = require("path");
const fs = require("fs");

const repoRoot = path.join(__dirname, "..", "..");
const preprodEnvPath = path.join(repoRoot, ".env.preproduction");
const isBootstrap =
  process.argv.includes("--bootstrap") || process.env.SOMAFRIK_BOOTSTRAP_SUPERADMIN === "true";

if (isBootstrap && fs.existsSync(preprodEnvPath)) {
  require("dotenv").config({ path: preprodEnvPath });
} else {
  require("dotenv").config({ path: path.join(repoRoot, ".env") });
  require("dotenv").config({ path: path.join(repoRoot, ".env.local"), override: true });
}

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { buildEmptyBackOfficeState } = require("../lib/emptyBackOfficeState");
const { syncSuperadminCredentials } = require("../lib/superadminBootstrap");

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

const TABLES = [
  "sessions",
  "idempotency_keys",
  "audit_logs",
  "payment_reminders",
  "student_fee_obligations",
  "backoffice_state",
  "notifications",
  "announcements",
  "payments",
  "attendance",
  "promotion_decisions",
  "student_documents",
  "exam_results",
  "exams",
  "grades",
  "teacher_assignments",
  "enrollments",
  "students",
  "teachers",
  "subject_class_assignments",
  "subjects",
  "classes",
  "terms",
  "academic_years",
  "users",
  "subscriptions",
  "schools",
  "countries",
];

async function wipeDatabase(pool) {
  await pool.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

async function saveEmptyBackOfficeState(pool) {
  const payload = buildEmptyBackOfficeState();
  await pool.query(
    `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
     VALUES ('default', $1::jsonb, NOW())
     ON CONFLICT (state_key) DO UPDATE SET
       state_payload = EXCLUDED.state_payload,
       updated_at = NOW()`,
    [JSON.stringify(payload)],
  );
  return payload;
}

async function bootstrapSuperAdmin(pool) {
  const creds = await syncSuperadminCredentials(pool);
  return {
    identifier: creds.identifier,
    password: String(process.env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "").trim(),
    email: creds.email,
  };
}

async function main() {
  const bootstrap = process.argv.includes("--bootstrap") || process.env.SOMAFRIK_BOOTSTRAP_SUPERADMIN === "true";
  const databaseUrl = resolveDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log("Connexion PostgreSQL…");
    await pool.query("SELECT 1");

    console.log("Suppression de toutes les données de démonstration…");
    await wipeDatabase(pool);

    console.log("Enregistrement d'un état BackOffice vide…");
    const state = await saveEmptyBackOfficeState(pool);

    if (bootstrap) {
      const creds = await bootstrapSuperAdmin(pool);
      console.log("");
      console.log("Compte Superadmin initial créé (changez le mot de passe à la première connexion) :");
      console.log(`  Identifiant : ${creds.identifier}`);
      console.log(`  Email        : ${creds.email}`);
      console.log("  Mot de passe : BOOTSTRAP_SUPERADMIN_PASSWORD dans .env.preproduction");
    } else {
      console.log("");
      console.log("Aucun compte créé. Relancez avec --bootstrap pour un Superadmin minimal.");
    }

    console.log("");
    console.log("Ajoutez dans .env pour éviter le re-seed automatique :");
    console.log("  SOMAFRIK_SKIP_DEMO_SEED=true");
    console.log("");
    console.log("Puis redémarrez le backend : npm run docker:down && npm run docker:up");
    console.log("Déconnectez-vous de la plateforme web (session navigateur).");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Échec du nettoyage :", error.message);
  process.exit(1);
});
