/**
 * Initialise une base vide pour la préproduction : superadmin + état BackOffice minimal.
 *
 * Usage :
 *   node backend/scripts/bootstrap-preprod.js
 *   node backend/scripts/bootstrap-preprod.js --confirm
 *
 * Prérequis (.env) :
 *   NODE_ENV=production
 *   SOMAFRIK_SKIP_DEMO_SEED=true
 *   POSTGRES_PASSWORD, JWT_SECRET forts
 *   BOOTSTRAP_SUPERADMIN_ID / BOOTSTRAP_SUPERADMIN_PASSWORD
 */
const path = require("path");
const { spawnSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { collectProductionSecretViolations } = require("../lib/productionSecrets");

function main() {
  const confirm = process.argv.includes("--confirm") || process.env.SOMAFRIK_BOOTSTRAP_SUPERADMIN === "true";

  if (!confirm) {
    console.error("Confirmation requise : relancez avec --confirm");
    console.error("  node backend/scripts/bootstrap-preprod.js --confirm");
    process.exit(1);
  }

  const violations = collectProductionSecretViolations(process.env);
  if (violations.length > 0) {
    console.error("Configuration non sécurisée pour la préproduction :");
    violations.forEach((message) => console.error(`  - ${message}`));
    process.exit(1);
  }

  const password = String(process.env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "").trim();
  if (!password || password.length < 12) {
    console.error("BOOTSTRAP_SUPERADMIN_PASSWORD doit contenir au moins 12 caractères.");
    process.exit(1);
  }

  const wipeScript = path.join(__dirname, "wipe-demo-data.js");
  const result = spawnSync(process.execPath, [wipeScript, "--bootstrap"], {
    stdio: "inherit",
    env: {
      ...process.env,
      SOMAFRIK_BOOTSTRAP_SUPERADMIN: "true",
      NODE_ENV: process.env.NODE_ENV || "production",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log("");
  console.log("Préproduction initialisée.");
  console.log("Prochaines étapes :");
  console.log("  1. npm run preprod:up");
  console.log("  2. Connexion : https://somafrik.app/web/connexion");
  console.log(`  3. Identifiant : ${process.env.BOOTSTRAP_SUPERADMIN_ID || "superadmin"}`);
  console.log("  4. Créer pays, établissements et comptes via le backoffice.");
}

main();
