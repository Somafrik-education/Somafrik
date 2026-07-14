/**
 * Valide .env.production avant docker compose production.
 */
const fs = require("fs");
const path = require("path");
const { collectProductionSecretViolations } = require("../backend/lib/productionSecrets");
const {
  collectProductionCorsViolations,
  PRODUCTION_FRONTEND_ORIGIN,
} = require("../backend/lib/corsConfig");

const PRODUCTION_ENV_PATH = path.join(__dirname, "..", ".env.production");

const PLACEHOLDER_VALUES = new Set([
  "change-me",
  "GENERER-MOT-DE-PASSE-FORT-ICI",
  "GENERER-SECRET-JWT-32-CARACTERES-MINIMUM-ICI",
  "change-this-long-random-secret-before-use",
]);

function loadProductionEnv() {
  if (!fs.existsSync(PRODUCTION_ENV_PATH)) {
    return {
      ok: false,
      errors: [
        "Fichier .env.production introuvable.",
        "Exécutez : npm run production:init-env",
        "Puis éditez .env.production (secrets forts) avant production:up.",
      ],
    };
  }

  require("dotenv").config({ path: PRODUCTION_ENV_PATH });
  const errors = validateProductionEnv(process.env);
  return { ok: errors.length === 0, errors };
}

function validateProductionEnv(env = process.env) {
  const errors = [];

  if (env.NODE_ENV !== "production") {
    errors.push("NODE_ENV doit valoir production dans .env.production.");
  }
  if (env.SOMAFRIK_SKIP_DEMO_SEED !== "true") {
    errors.push("SOMAFRIK_SKIP_DEMO_SEED=true est obligatoire en production.");
  }

  errors.push(...collectProductionSecretViolations(env));
  errors.push(...collectProductionCorsViolations(env));

  const postgresPassword = String(env.POSTGRES_PASSWORD ?? "").trim();
  if (PLACEHOLDER_VALUES.has(postgresPassword)) {
    errors.push("POSTGRES_PASSWORD utilise encore une valeur d'exemple ou placeholder.");
  }

  const jwtSecret = String(env.JWT_SECRET ?? "").trim();
  if (PLACEHOLDER_VALUES.has(jwtSecret)) {
    errors.push("JWT_SECRET utilise encore une valeur d'exemple ou placeholder.");
  }

  if (!String(env.CORS_ORIGINS ?? "").trim()) {
    errors.push(`CORS_ORIGINS est requis (valeur attendue : ${PRODUCTION_FRONTEND_ORIGIN}).`);
  }

  if (!String(env.SOMAFRIK_API_DOMAIN ?? "").trim()) {
    errors.push("SOMAFRIK_API_DOMAIN est requis (ex. api.somafrik.app).");
  }

  return errors;
}

function main() {
  const result = loadProductionEnv();
  if (result.ok) {
    console.log("Configuration production OK (.env.production).");
    process.exit(0);
  }

  console.error("Configuration production invalide :");
  result.errors.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { PRODUCTION_ENV_PATH, loadProductionEnv, validateProductionEnv };
