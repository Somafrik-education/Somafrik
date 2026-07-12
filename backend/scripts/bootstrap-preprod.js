/**
 * Initialise une base vide pour la préproduction : superadmin + état BackOffice minimal.
 *
 * Usage :
 *   npm run preprod:bootstrap
 *
 * Prérequis (.env.preproduction) :
 *   Stack preprod démarré (npm run preprod:up)
 *   Secrets forts + BOOTSTRAP_SUPERADMIN_PASSWORD (≥ 12 car.)
 */
const path = require("path");
const { spawnSync } = require("child_process");

const { loadPreprodEnv } = require("../../scripts/validate-preprod-env");

const repoRoot = path.join(__dirname, "..", "..");
const composeFile = "docker-compose.preprod.yml";
const envFile = ".env.preproduction";

function runDockerBootstrap(preprodEnv) {
  const bootstrapId = preprodEnv.BOOTSTRAP_SUPERADMIN_ID || "superadmin";
  const bootstrapPassword = preprodEnv.BOOTSTRAP_SUPERADMIN_PASSWORD;
  const bootstrapEmail = preprodEnv.BOOTSTRAP_SUPERADMIN_EMAIL || "superadmin@somafrik.app";

  return spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "--env-file",
      envFile,
      "exec",
      "-T",
      "-e",
      "SOMAFRIK_BOOTSTRAP_SUPERADMIN=true",
      "-e",
      `BOOTSTRAP_SUPERADMIN_ID=${bootstrapId}`,
      "-e",
      `BOOTSTRAP_SUPERADMIN_PASSWORD=${bootstrapPassword}`,
      "-e",
      `BOOTSTRAP_SUPERADMIN_EMAIL=${bootstrapEmail}`,
      "backend",
      "node",
      "scripts/wipe-demo-data.js",
      "--bootstrap",
    ],
    {
      stdio: "inherit",
      cwd: repoRoot,
      env: process.env,
    },
  );
}

function isPreprodBackendRunning() {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "--env-file",
      envFile,
      "ps",
      "--status",
      "running",
      "-q",
      "backend",
    ],
    {
      encoding: "utf8",
      cwd: repoRoot,
      env: process.env,
    },
  );

  return Boolean(result.stdout?.trim());
}

function main() {
  const confirm = process.argv.includes("--confirm") || process.env.SOMAFRIK_BOOTSTRAP_SUPERADMIN === "true";

  if (!confirm) {
    console.error("Confirmation requise : relancez avec --confirm");
    console.error("  npm run preprod:bootstrap");
    process.exit(1);
  }

  const validation = loadPreprodEnv();
  if (!validation.ok) {
    console.error("Configuration non sécurisée pour la préproduction :");
    validation.errors.forEach((message) => console.error(`  - ${message}`));
    process.exit(1);
  }

  const preprodEnv = validation.env ?? process.env;

  if (!isPreprodBackendRunning()) {
    console.error("Le conteneur backend préprod n'est pas démarré.");
    console.error("Lancez d'abord : npm run preprod:up");
    process.exit(1);
  }

  console.log("Bootstrap via le conteneur backend (réseau Docker interne)…");
  const result = runDockerBootstrap(preprodEnv);

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log("");
  console.log("Préproduction initialisée.");
  console.log("Prochaines étapes :");
  console.log("  1. Déployer le frontend sur Vercel (branche develop → preprod.somafrik.app)");
  console.log("  2. Connexion : https://preprod.somafrik.app/connexion");
  console.log(`  3. Identifiant : ${preprodEnv.BOOTSTRAP_SUPERADMIN_ID || "superadmin"}`);
  console.log("  4. Créer pays, établissements et comptes via le backoffice.");
}

main();
