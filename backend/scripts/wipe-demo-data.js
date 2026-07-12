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
const { hashSecret } = require("../services/credentialService");

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

async function bootstrapSuperAdmin(pool, state) {
  const identifier = String(process.env.BOOTSTRAP_SUPERADMIN_ID ?? "superadmin").trim();
  const password = String(process.env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "change-me-now").trim();
  const email = String(process.env.BOOTSTRAP_SUPERADMIN_EMAIL ?? "superadmin@somafrik.app").trim();
  const userCode = String(process.env.BOOTSTRAP_SUPERADMIN_CODE ?? "USR-2026-000002").trim();

  const row = await pool.query(
    `INSERT INTO users (
      school_id, user_code, first_name, last_name, email, phone,
      password_hash, pin_hash, role, status, must_change_password
    ) VALUES (
      NULL, $1, $2, $3, $4, '', $5, $5, 'SUPER_ADMIN', 'active', TRUE
    )
    RETURNING id, user_code, first_name, last_name, email, role, status`,
    [userCode, "Super", "Admin", email, hashSecret(password)],
  );

  const dbUser = row.rows[0];
  const account = {
    id: dbUser.id,
    publicId: dbUser.user_code,
    firstName: "Super",
    lastName: "Admin",
    email,
    role: "Super Administrateur Somafrik",
    identifier,
    password,
    schoolCode: "*",
    countryScope: "",
    scopeLevel: "Global",
    accessChannel: "Application",
    status: "Actif",
    permissions: ["ALL_PRIVILEGES"],
    mustChangePassword: true,
  };

  state.users = [account];
  state.updatedAt = new Date().toISOString();

  await pool.query(
    `UPDATE backoffice_state
     SET state_payload = $1::jsonb, updated_at = NOW()
     WHERE state_key = 'default'`,
    [JSON.stringify(state)],
  );

  return { identifier, password, email };
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
      const creds = await bootstrapSuperAdmin(pool, state);
      console.log("");
      console.log("Compte Superadmin initial créé (changez le mot de passe à la première connexion) :");
      console.log(`  Identifiant : ${creds.identifier}`);
      console.log(`  Mot de passe : ${creds.password}`);
      console.log(`  Email        : ${creds.email}`);
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
