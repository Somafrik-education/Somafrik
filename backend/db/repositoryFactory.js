/**
 * Fabrique de dépôts: point de composition unique de la couche de persistance.
 *
 * S2.2 — en production : PostgreSQL obligatoire, aucun fallback mémoire.
 * S2.2.1 — mode mémoire développement sans credentials : fallback fiable.
 */

const { PostgresRepository } = require("./postgresRepository");
const { FallbackRepository } = require("./fallbackRepository");
const {
  resolveDatabaseConfig,
  isDatabaseRequired,
  isMemoryFallbackAllowed,
  isProductionEnvironment,
  sanitizeDbErrorMessage,
  DbConfigError,
  assertDatabaseConfiguration,
} = require("./connectionConfig");
const { assertRepositoryContract } = require("./repositoryContract");

function hasResolvableDatabaseConfig(env = process.env) {
  try {
    resolveDatabaseConfig(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Crée le dépôt PostgreSQL (non initialisé).
 * @param {string|object|null} [databaseConfig] URL ou config pool explicite.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {PostgresRepository}
 */
function createPostgresRepository(databaseConfig, env = process.env) {
  let config;
  if (databaseConfig != null) {
    config =
      typeof databaseConfig === "string"
        ? { connectionString: databaseConfig }
        : databaseConfig;
  } else if (isMemoryFallbackAllowed(env)) {
    // Mode démo local : pas d'exigence de secrets au chargement du module.
    try {
      config = resolveDatabaseConfig(env).poolConfig;
    } catch {
      // URL non secrète, volontairement injoignable — uniquement pour différer le fallback mémoire.
      config = { connectionString: "postgresql://127.0.0.1:1/postgres" };
    }
  } else {
    config = resolveDatabaseConfig(env).poolConfig;
  }
  const repository = new PostgresRepository(config);
  repository.engine = "postgresql";
  return assertRepositoryContract(repository, "postgresql");
}

/**
 * Crée le dépôt mémoire de secours (mode démo local uniquement).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {FallbackRepository}
 */
function createFallbackRepository(env = process.env) {
  if (isProductionEnvironment(env)) {
    throw new DbConfigError(
      "Le dépôt mémoire est interdit en production.",
    );
  }
  return assertRepositoryContract(new FallbackRepository(), "memory");
}

/**
 * Initialise la persistance.
 *
 * En production (ou SOMAFRIK_DB_REQUIRED=true) : PostgreSQL obligatoire.
 * Le fallback mémoire n'est autorisé qu'en développement/test explicite.
 *
 * @param {object} [options]
 * @param {object} [options.repository] Dépôt PostgreSQL pré-construit à réutiliser.
 * @param {string|object|null} [options.databaseUrl] URL / config explicite.
 * @param {boolean} [options.required] Interdit le repli mémoire.
 * @param {Console} [options.logger] Journaliseur (défaut: console).
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{ repository: object, engine: string, usedFallback: boolean }>}
 */
async function initializeRepository({
  repository = null,
  databaseUrl = null,
  required = null,
  logger = console,
  env = process.env,
} = {}) {
  assertDatabaseConfiguration(env);

  const mustUsePostgres = required == null ? isDatabaseRequired(env) : Boolean(required);
  if (isProductionEnvironment(env) && !mustUsePostgres) {
    throw new DbConfigError(
      "PostgreSQL est obligatoire en production (aucun fallback mémoire).",
    );
  }

  // S2.2.1 — mémoire explicite sans config BD : pas de tentative PostgreSQL inutile.
  if (
    repository == null &&
    databaseUrl == null &&
    !mustUsePostgres &&
    isMemoryFallbackAllowed(env) &&
    !hasResolvableDatabaseConfig(env)
  ) {
    logger.warn("Aucune configuration PostgreSQL : démarrage en mode démo mémoire.");
    const fallback = createFallbackRepository(env);
    await fallback.init();
    return {
      repository: fallback,
      engine: fallback.engine ?? "memory",
      usedFallback: true,
    };
  }

  // Laisser createPostgresRepository gérer le mode mémoire (placeholder si besoin).
  const primary = repository ?? createPostgresRepository(databaseUrl, env);

  try {
    await primary.init();
    if (isProductionEnvironment(env) && (primary.engine ?? "postgresql") === "memory") {
      throw new DbConfigError("Base mémoire détectée en production.");
    }
    return {
      repository: primary,
      engine: primary.engine ?? "postgresql",
      usedFallback: false,
    };
  } catch (error) {
    if (error instanceof DbConfigError) {
      throw error;
    }
    if (mustUsePostgres || isProductionEnvironment(env)) {
      throw new DbConfigError(
        "Connexion PostgreSQL obligatoire impossible.",
      );
    }

    logger.warn("PostgreSQL indisponible, démarrage en mode démo mémoire.");
    logger.warn(`Cause: ${sanitizeDbErrorMessage(error)}`);

    const fallback = createFallbackRepository(env);
    await fallback.init();
    return {
      repository: fallback,
      engine: fallback.engine ?? "memory",
      usedFallback: true,
    };
  }
}

module.exports = {
  createPostgresRepository,
  createFallbackRepository,
  initializeRepository,
};
