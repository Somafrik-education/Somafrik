/**
 * Réaligne le superadmin (users + backoffice_state) sur .env.preproduction.
 *
 * Usage : npm run preprod:repair-superadmin
 */
const path = require("path");
const { spawnSync } = require("child_process");
const { loadPreprodEnv } = require("../../scripts/validate-preprod-env");

const repoRoot = path.join(__dirname, "..", "..");
const composeFile = "docker-compose.preprod.yml";
const envFile = ".env.preproduction";

function isPreprodBackendRunning() {
  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "--env-file", envFile, "ps", "--status", "running", "-q", "backend"],
    { encoding: "utf8", cwd: repoRoot },
  );
  return Boolean(result.stdout?.trim());
}

function runRepairInContainer(preprodEnv) {
  const args = [
    "compose",
    "-f",
    composeFile,
    "--env-file",
    envFile,
    "exec",
    "-T",
    "-e",
    "SOMAFRIK_REPAIR_SUPERADMIN=true",
    "-e",
    `BOOTSTRAP_SUPERADMIN_ID=${preprodEnv.BOOTSTRAP_SUPERADMIN_ID || "superadmin"}`,
    "-e",
    `BOOTSTRAP_SUPERADMIN_PASSWORD=${preprodEnv.BOOTSTRAP_SUPERADMIN_PASSWORD}`,
    "-e",
    `BOOTSTRAP_SUPERADMIN_EMAIL=${preprodEnv.BOOTSTRAP_SUPERADMIN_EMAIL || "superadmin@somafrik.app"}`,
    "-e",
    `BOOTSTRAP_SUPERADMIN_CODE=${preprodEnv.BOOTSTRAP_SUPERADMIN_CODE || "USR-2026-000002"}`,
    "backend",
    "node",
    "scripts/repair-superadmin-credentials.js",
  ];

  return spawnSync("docker", args, { stdio: "inherit", cwd: repoRoot });
}

function main() {
  const validation = loadPreprodEnv();
  if (!validation.ok) {
    console.error("Configuration préproduction invalide.");
    validation.errors.forEach((message) => console.error(`  - ${message}`));
    process.exit(1);
  }

  if (!isPreprodBackendRunning()) {
    console.error("Le conteneur backend préprod n'est pas démarré. Lancez : npm run preprod:up");
    process.exit(1);
  }

  const result = runRepairInContainer(validation.env);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log("");
  console.log("Superadmin réaligné.");
  console.log(`  Identifiant : ${validation.env.BOOTSTRAP_SUPERADMIN_ID || "superadmin"}`);
  console.log("  Mot de passe : valeur de BOOTSTRAP_SUPERADMIN_PASSWORD dans .env.preproduction");
}

main();
