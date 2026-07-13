/**
 * Valide .env.preproduction avant bootstrap / docker compose préprod.
 */
const fs = require("fs");
const path = require("path");
const { collectProductionSecretViolations } = require("../backend/lib/productionSecrets");
const { collectProductionCorsViolations } = require("../backend/lib/corsConfig");

const PREPROD_ENV_PATH = path.join(__dirname, "..", ".env.preproduction");

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadPreprodEnv() {
  if (!fs.existsSync(PREPROD_ENV_PATH)) {
    return {
      ok: false,
      errors: [
        "Fichier .env.preproduction introuvable.",
        "Exécutez : npm run preprod:init-env",
        "Puis éditez .env.preproduction (secrets forts) avant preprod:bootstrap.",
      ],
    };
  }

  const env = { ...process.env, ...parseEnvFile(PREPROD_ENV_PATH) };
  const errors = validatePreprodEnv(env);
  return { ok: errors.length === 0, errors, env };
}

function validatePreprodEnv(env = process.env) {
  const errors = [];

  if (env.NODE_ENV !== "production") {
    errors.push("NODE_ENV doit valoir production dans .env.preproduction.");
  }
  if (env.SOMAFRIK_SKIP_DEMO_SEED !== "true") {
    errors.push("SOMAFRIK_SKIP_DEMO_SEED=true est obligatoire en préproduction.");
  }

  errors.push(...collectProductionSecretViolations(env));
  errors.push(...collectProductionCorsViolations(env));

  const bootstrapPassword = String(env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "").trim();
  if (!bootstrapPassword || bootstrapPassword.length < 12) {
    errors.push("BOOTSTRAP_SUPERADMIN_PASSWORD doit contenir au moins 12 caractères.");
  }
  if (bootstrapPassword === "GENERER-MOT-DE-PASSE-FORT-ICI") {
    errors.push("BOOTSTRAP_SUPERADMIN_PASSWORD utilise encore le placeholder du modèle.");
  }

  if (!String(env.CORS_ORIGINS ?? "").trim()) {
    errors.push("CORS_ORIGINS est requis (ex. https://preprod.somafrik.app).");
  }

  return errors;
}

function main() {
  const result = loadPreprodEnv();
  if (result.ok) {
    console.log("Configuration préproduction OK (.env.preproduction).");
    process.exit(0);
  }

  console.error("Configuration préproduction invalide :");
  result.errors.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { PREPROD_ENV_PATH, loadPreprodEnv, validatePreprodEnv };
