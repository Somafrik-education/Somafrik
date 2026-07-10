/**
 * Audit d'intégrité des données Somafrik (backoffice_state).
 *
 *   npm run audit:integrity
 */
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch {
  // optional
}

const { auditBackOfficeState } = require("../backend/services/dataIntegrityService");

async function loadStateViaApi() {
  const { login, getState, SUPERADMIN_ID, SUPERADMIN_PASSWORD } = require("./e2e-api-helpers");
  const token = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const state = await getState(token);
  return { state, updatedAt: new Date().toISOString(), source: "api" };
}

async function loadState() {
  try {
    const backendRoot = path.join(__dirname, "..", "backend");
    const { Pool } = require(path.join(backendRoot, "node_modules", "pg"));
    const { buildDatabaseUrl } = require(path.join(backendRoot, "db", "connectionConfig"));
    let databaseUrl = process.env.DATABASE_URL || buildDatabaseUrl();
    const hostPort = process.env.POSTGRES_HOST_PORT;
    if (hostPort && !process.env.POSTGRES_PORT) {
      databaseUrl = databaseUrl.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
    }
    const pool = new Pool({ connectionString: databaseUrl });
    const row = await pool.query(
      "SELECT state_payload, updated_at FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    await pool.end();
    return {
      state: row.rows[0]?.state_payload ?? {},
      updatedAt: row.rows[0]?.updated_at ?? null,
      source: "postgres",
    };
  } catch (error) {
    console.warn(`Connexion PostgreSQL indisponible (${error.code ?? error.message}) — repli API.`);
    return loadStateViaApi();
  }
}

function printIssues(issues, limit = 30) {
  const shown = issues.slice(0, limit);
  for (const issue of shown) {
    console.log(
      `  [${issue.severity}] ${issue.category}/${issue.code} — ${issue.message}`,
    );
  }
  if (issues.length > limit) {
    console.log(`  … ${issues.length - limit} autre(s) problème(s)`);
  }
}

async function main() {
  console.log("\n=== Audit intégrité données Somafrik ===\n");
  const { state, updatedAt, source } = await loadState();
  const report = auditBackOfficeState(state);

  console.log(`Source          : ${source ?? "postgres"}`);
  console.log(`État backoffice : ${updatedAt ?? "—"}`);
  console.log(`Établissements  : ${(state.schools ?? []).length}`);
  console.log(`Élèves          : ${(state.students ?? []).length}`);
  console.log(`Notes           : ${(state.notes ?? []).length}`);
  console.log(`Paiements       : ${(state.payments ?? []).length}`);
  console.log(`Présences       : ${(state.presences ?? []).length}`);
  console.log("");

  console.log("Résumé");
  console.log(`  Total problèmes : ${report.summary.total}`);
  console.log(`  Critiques       : ${report.summary.bySeverity.critical ?? 0}`);
  console.log(`  Élevés          : ${report.summary.bySeverity.high ?? 0}`);
  console.log(`  Moyens          : ${report.summary.bySeverity.medium ?? 0}`);
  console.log("  Par catégorie   :", report.summary.byCategory);
  console.log("");

  const groups = [
    ["Référentiel", report.issues.filter((item) => item.category === "referential")],
    ["Multi-établissement", report.issues.filter((item) => item.category === "cross_school")],
    ["Doublons", report.issues.filter((item) => item.category === "duplicate")],
    ["Champs requis / formats", report.issues.filter((item) => ["required", "format"].includes(item.category))],
    ["Calculs (soldes)", report.issues.filter((item) => item.category === "calculation")],
  ];

  for (const [label, issues] of groups) {
    if (!issues.length) continue;
    console.log(`${label} (${issues.length})`);
    printIssues(issues);
    console.log("");
  }

  if (report.ok) {
    console.log("Audit intégrité : OK (aucun problème critique)");
    process.exit(0);
  }

  console.error("Audit intégrité : ÉCHEC — problèmes critiques détectés");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
