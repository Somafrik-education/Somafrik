/**
 * Nettoyage des données créées par les tests E2E (établissements, utilisateurs, entités liées).
 *
 * Usage :
 *   node scripts/cleanup-e2e-data.js              # aperçu (dry-run)
 *   node scripts/cleanup-e2e-data.js --confirm    # exécution
 *   npm run cleanup:e2e
 *   npm run cleanup:e2e -- --confirm
 *
 * Prérequis : backend accessible (Docker ou local).
 */
const path = require("path");
const {
  login,
  getState,
  putState,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
} = require("./e2e-api-helpers");
const { findE2eSchools, purgeE2eFromState, PROTECTED_SCHOOL_CODES } = require("./e2e-cleanup-rules");

const confirm = process.argv.includes("--confirm");

async function deletePostgresE2eSchools(schoolCodes) {
  if (!schoolCodes.length) return { deleted: 0, skipped: 0, errors: [] };

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    return { deleted: 0, skipped: schoolCodes.length, errors: ["Module pg indisponible"] };
  }

  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), override: true });

  const { buildDatabaseUrl } = require("../backend/db/connectionConfig");
  const databaseUrl = process.env.DATABASE_URL || buildDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });

  let deleted = 0;
  let skipped = 0;
  const errors = [];

  try {
    for (const schoolCode of schoolCodes) {
      try {
        const schoolRes = await pool.query(
          "SELECT id, name FROM schools WHERE UPPER(school_code) = $1 LIMIT 1",
          [schoolCode.toUpperCase()],
        );
        const school = schoolRes.rows[0];
        if (!school) {
          skipped += 1;
          continue;
        }

        const schoolId = school.id;
        await pool.query("DELETE FROM attendance WHERE school_id = $1", [schoolId]);
        await pool.query(
          `DELETE FROM grades WHERE student_id IN (SELECT id FROM students WHERE school_id = $1)`,
          [schoolId],
        );
        await pool.query("DELETE FROM payments WHERE school_id = $1", [schoolId]);
        await pool.query(
          `DELETE FROM enrollments WHERE student_id IN (SELECT id FROM students WHERE school_id = $1)`,
          [schoolId],
        );
        await pool.query("DELETE FROM students WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM teacher_assignments WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM teachers WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM subject_class_assignments WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM classes WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM subjects WHERE school_id = $1", [schoolId]);
        await pool.query(
          `DELETE FROM terms WHERE academic_year_id IN (SELECT id FROM academic_years WHERE school_id = $1)`,
          [schoolId],
        );
        await pool.query("DELETE FROM academic_years WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM users WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM subscriptions WHERE school_id = $1", [schoolId]);
        await pool.query("DELETE FROM schools WHERE id = $1", [schoolId]);
        deleted += 1;
      } catch (error) {
        errors.push(`${schoolCode}: ${error.message}`);
      }
    }
  } finally {
    await pool.end();
  }

  return { deleted, skipped, errors };
}

async function main() {
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const state = await getState(superToken);
  const targets = findE2eSchools(state.schools ?? []);

  console.log("\n=== Nettoyage données E2E ===\n");
  console.log(`Mode            : ${confirm ? "EXÉCUTION" : "APERÇU (dry-run)"}`);
  console.log(`Établissements protégés : ${[...PROTECTED_SCHOOL_CODES].join(", ") || "—"}`);
  console.log(`Établissements E2E détectés : ${targets.length}\n`);

  if (!targets.length) {
    console.log("Aucune donnée E2E à nettoyer.");
    return;
  }

  console.table(
    targets.map((school) => ({
      Code: school.code ?? school.publicId,
      Nom: school.name,
      Email: school.email ?? "—",
      Statut: school.status ?? "—",
    })),
  );

  const { state: cleaned, stats, e2eSchoolCodes } = purgeE2eFromState(state);

  console.log("\nEntités à retirer du state BackOffice :");
  console.table(
    Object.entries(stats).map(([key, count]) => ({
      Entité: key,
      Suppressions: count,
    })),
  );

  if (!confirm) {
    console.log("\nAucune modification effectuée.");
    console.log("Relancez avec --confirm pour appliquer le nettoyage :");
    console.log("  npm run cleanup:e2e -- --confirm\n");
    return;
  }

  await putState(superToken, cleaned);
  console.log("\nState BackOffice mis à jour.");

  const pgResult = await deletePostgresE2eSchools(e2eSchoolCodes);
  console.log(`PostgreSQL : ${pgResult.deleted} établissement(s) supprimé(s), ${pgResult.skipped} absent(s).`);
  if (pgResult.errors.length) {
    console.warn("Avertissements PostgreSQL :");
    for (const message of pgResult.errors) {
      console.warn(`  - ${message}`);
    }
  }

  const verifyState = await getState(superToken);
  const remaining = findE2eSchools(verifyState.schools ?? []);
  console.log(`\nVérification : ${remaining.length} établissement(s) E2E restant(s).`);

  if (remaining.length) {
    console.error("Échec : des établissements E2E sont encore présents.");
    process.exit(1);
  }

  console.log("Nettoyage E2E : OK\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
