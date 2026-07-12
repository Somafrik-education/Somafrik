const DEFAULT_POSTGRES_PASSWORD = "change-me";
const EXAMPLE_JWT_SECRET = "change-this-long-random-secret-before-use";
const KNOWN_WEAK_JWT_SECRETS = new Set([
  EXAMPLE_JWT_SECRET,
  "somafrik-dev-secret-change-me",
]);
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Résout le mot de passe PostgreSQL effectif (variable directe, DATABASE_URL, ou défaut local).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolvePostgresPassword(env = process.env) {
  const direct = String(env.POSTGRES_PASSWORD ?? "").trim();
  if (direct) return direct;

  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.password) return decodeURIComponent(parsed.password);
    } catch {
      // URL mal formée : on retombe sur le défaut de développement.
    }
  }

  return "somafrik123";
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function collectProductionSecretViolations(env = process.env) {
  if (env.NODE_ENV !== "production") return [];

  const violations = [];
  const postgresPassword = resolvePostgresPassword(env);

  if (postgresPassword === DEFAULT_POSTGRES_PASSWORD) {
    violations.push("POSTGRES_PASSWORD utilise encore la valeur d'exemple « change-me ».");
  }

  const jwtSecret = String(env.JWT_SECRET ?? "").trim();
  if (!jwtSecret) {
    violations.push("JWT_SECRET est obligatoire en production.");
  } else {
    if (KNOWN_WEAK_JWT_SECRETS.has(jwtSecret)) {
      violations.push("JWT_SECRET correspond à une valeur d'exemple ou de développement connue.");
    }
    if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      violations.push(`JWT_SECRET est trop court (minimum ${MIN_JWT_SECRET_LENGTH} caractères).`);
    }
  }

  if (env.SOMAFRIK_SKIP_DEMO_SEED !== "true") {
    violations.push(
      "SOMAFRIK_SKIP_DEMO_SEED=true est obligatoire en production pour empêcher la création des comptes de démonstration.",
    );
  }

  if (env.SOMAFRIK_DISABLE_LOGIN_LOCKOUT === "true") {
    violations.push(
      "SOMAFRIK_DISABLE_LOGIN_LOCKOUT doit être false (ou absent) en production.",
    );
  }

  if (env.SOMAFRIK_AUTH_OPTIONAL === "true") {
    violations.push("SOMAFRIK_AUTH_OPTIONAL=true est interdit en production.");
  }

  if (env.SOMAFRIK_E2E === "true") {
    violations.push("SOMAFRIK_E2E=true est interdit en production.");
  }

  return violations;
}

/**
 * Bloque le démarrage en production si des secrets par défaut ou trop faibles sont détectés.
 * @param {NodeJS.ProcessEnv} [env]
 */
function assertProductionSecrets(env = process.env) {
  const violations = collectProductionSecretViolations(env);
  if (violations.length === 0) return;

  throw new Error(
    `Configuration de production non sécurisée:\n- ${violations.join("\n- ")}`
  );
}

/**
 * Avertit en développement lorsque JWT_SECRET n'est pas défini.
 * @param {NodeJS.ProcessEnv} [env]
 */
function warnIfUnsafeDevelopmentSecrets(env = process.env) {
  if (env.NODE_ENV === "production") return;
  if (!env.JWT_SECRET) {
    console.warn("JWT_SECRET non défini: utilisation du secret de développement.");
  }
}

module.exports = {
  DEFAULT_POSTGRES_PASSWORD,
  EXAMPLE_JWT_SECRET,
  MIN_JWT_SECRET_LENGTH,
  resolvePostgresPassword,
  collectProductionSecretViolations,
  assertProductionSecrets,
  warnIfUnsafeDevelopmentSecrets,
};
