/**
 * Purge contrôlée des données de démonstration / préproduction.
 *
 * Objectif V2 : repartir d'un état tenant vide sans assouplir les migrations
 * fail-closed (notamment USER_ROLES_MIGRATION_AMBIGUOUS).
 *
 * Conservé :
 *   - référentiel countries ;
 *   - catalogues de rôles / permissions ;
 *   - schéma et migrations PostgreSQL.
 *
 * Supprimé :
 *   - établissements de test et toutes leurs données métier ;
 *   - utilisateurs / user_roles / sessions ;
 *   - compteurs d'identifiants ;
 *   - état BackOffice résiduel.
 *
 * Usage préproduction (depuis backend/) :
 *   node scripts/wipe-demo-data.js --confirm=WIPE_PREPROD_TEST_DATA --bootstrap
 *
 * Variables requises pour --bootstrap :
 *   BOOTSTRAP_SUPERADMIN_PASSWORD (>= 12 caractères)
 * Variables utiles :
 *   DATABASE_URL ou POSTGRES_*
 *   BOOTSTRAP_SUPERADMIN_ID=superadmin
 *   BOOTSTRAP_SUPERADMIN_EMAIL=superadmin@somafrik.app
 *   SOMAFRIK_SKIP_DEMO_SEED=true
 */
const path = require("path");
const fs = require("fs");

const repoRoot = path.join(__dirname, "..", "..");
const preprodEnvPath = path.join(repoRoot, ".env.preproduction");
const CONFIRMATION = "WIPE_PREPROD_TEST_DATA";
const confirmationArg = process.argv.find((arg) => arg.startsWith("--confirm="));
const confirmation = String(confirmationArg?.slice("--confirm=".length) ?? "").trim();
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
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

// Les tables absentes sont ignorées : le script reste compatible avec les
// différents états de migration d'une préproduction en reconstruction.
const PURGE_TABLES = [
  "sessions",
  "idempotency_keys",
  "audit_logs",
  "payment_reminders",
  "student_fee_obligations",
  "notifications",
  "announcements",
  "payments",
  "attendance",
  "promotion_decisions",
  "student_documents",
  "exam_results",
  "exams",
  "grades",
  "evaluations",
  "teacher_assignments",
  "enrollments",
  "students",
  "teachers",
  "subject_class_assignments",
  "course_schedule_slots",
  "school_courses",
  "subjects",
  "classes",
  "terms",
  "academic_years",
  "contacts",
  "contact_relations",
  "user_roles",
  "users",
  "subscriptions",
  "backoffice_state",
  // Compteurs sans FK : ils doivent impérativement repartir à zéro afin que
  // la prochaine donnée réelle reçoive bien ...-001 / ...-00001.
  "identity_counters",
  "user_code_counters",
  "school_login_code_counters",
  "student_login_code_counters",
  "school_login_counters",
  "school_code_counters",
  "school_counters",
  "schools",
];

async function existingTables(pool, names) {
  const result = await pool.query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])`,
    [names],
  );
  const found = new Set(result.rows.map((row) => row.tablename));
  return names.filter((name) => found.has(name));
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function wipeDatabase(pool) {
  const tables = await existingTables(pool, PURGE_TABLES);
  if (!tables.includes("users")) {
    throw new Error("Purge refusée : table users absente.");
  }

  await pool.query("BEGIN");
  try {
    if (tables.length) {
      await pool.query(
        `TRUNCATE TABLE ${tables.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  return tables;
}

async function saveEmptyBackOfficeState(pool) {
  const exists = await existingTables(pool, ["backoffice_state"]);
  if (!exists.length) return null;

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
    email: creds.email,
    userCode: creds.userCode,
  };
}

async function verifyPurge(pool, bootstrap) {
  const checks = {};
  for (const table of await existingTables(pool, ["schools", "students", "teachers", "user_roles"])) {
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(table)}`);
    checks[table] = result.rows[0].count;
  }

  const users = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  checks.users = users.rows[0].count;

  if ((checks.schools ?? 0) !== 0 || (checks.students ?? 0) !== 0 || (checks.teachers ?? 0) !== 0) {
    throw new Error(`Purge incomplète : ${JSON.stringify(checks)}`);
  }
  if ((checks.user_roles ?? 0) !== 0) {
    throw new Error(`Purge incomplète : user_roles=${checks.user_roles}`);
  }
  if (bootstrap && checks.users !== 1) {
    throw new Error(`Bootstrap invalide : ${checks.users} utilisateur(s), attendu 1 Superadmin.`);
  }
  if (!bootstrap && checks.users !== 0) {
    throw new Error(`Purge incomplète : users=${checks.users}`);
  }

  return checks;
}

async function main() {
  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `Purge refusée. Confirmation explicite requise : --confirm=${CONFIRMATION}`,
    );
  }

  const databaseUrl = resolveDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log("Connexion PostgreSQL…");
    await pool.query("SELECT 1");

    console.log("Purge contrôlée des données de test tenant…");
    const truncated = await wipeDatabase(pool);
    console.log(`Tables purgées (${truncated.length}) : ${truncated.join(", ")}`);

    await saveEmptyBackOfficeState(pool);

    let creds = null;
    if (isBootstrap) {
      creds = await bootstrapSuperAdmin(pool);
      console.log("Compte Superadmin minimal recréé.");
      console.log(`  Identifiant : ${creds.identifier}`);
      console.log(`  Email       : ${creds.email}`);
      console.log(`  User code   : ${creds.userCode}`);
      console.log("  Mot de passe: BOOTSTRAP_SUPERADMIN_PASSWORD (jamais affiché)");
    }

    const checks = await verifyPurge(pool, isBootstrap);
    console.log(`Vérification post-purge OK : ${JSON.stringify(checks)}`);
    console.log("Référentiel countries et catalogues RBAC conservés.");
    console.log("SOMAFRIK_SKIP_DEMO_SEED=true doit rester activé avant redémarrage.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Échec du nettoyage :", error.message);
  process.exit(1);
});
