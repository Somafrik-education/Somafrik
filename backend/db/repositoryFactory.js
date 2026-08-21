/**
 * Fabrique de dépôts: point de composition unique de la couche de persistance.
 *
 * S2.2 — en production : PostgreSQL obligatoire, aucun fallback mémoire.
 * S2.2.1 — mode mémoire développement sans credentials : fallback fiable.
 */

const { PostgresRepository } = require("./postgresRepository");
const { FallbackRepository } = require("./fallbackRepository");
const {
  attachStudentLifecyclePg,
  ensureStudentLifecyclePgSchema,
} = require("./studentLifecyclePg");
const { ensureStudentGeneralIdentityPg } = require("./studentGeneralIdentityPg");
const { attachCanonicalDemoSeedPostgres } = require("./demoSeedPostgres");
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
 * P1 REMOVE-LEGACY-SYNC-CORE — neutralise les anciennes migrations runtime qui
 * relisaient `backoffice_state.state_payload` pour réinjecter evaluations/notes.
 *
 * Les données historiques restent en base pour audit/cleanup explicite : on ne
 * les efface pas ici. La seule règle est qu'elles ne peuvent plus redevenir une
 * source d'écriture vers les tables PostgreSQL canoniques au démarrage.
 */
function disableLegacyBackOfficeRuntimeMigrations(repository) {
  if (!repository || (repository.engine ?? "postgresql") !== "postgresql") {
    return repository;
  }

  if (typeof repository.migrateEvaluationsFromBackOffice === "function") {
    repository.migrateEvaluationsFromBackOffice = async () => undefined;
  }
  if (typeof repository.migrateNotesFromBackOffice === "function") {
    repository.migrateNotesFromBackOffice = async () => undefined;
  }

  return repository;
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
  attachCanonicalDemoSeedPostgres(repository);
  attachStudentLifecyclePg(repository);
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
  disableLegacyBackOfficeRuntimeMigrations(primary);
  if ((primary.engine ?? "postgresql") === "postgresql") {
    attachCanonicalDemoSeedPostgres(primary);
    attachStudentLifecyclePg(primary);
  }

  try {
    await primary.init();
    if ((primary.engine ?? "postgresql") === "postgresql") {
      await ensureStudentLifecyclePgSchema(primary);
      await ensureStudentGeneralIdentityPg(primary);
    }
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

    // Toujours journaliser la cause réelle (sanitisée) — y compris contraintes domaine Teachers.
    const cause = sanitizeDbErrorMessage(error);
    const domainCode = error && error.code ? String(error.code) : "";

    if (mustUsePostgres || isProductionEnvironment(env)) {
      logger.error(`Échec initialisation PostgreSQL: ${cause}`);
      if (domainCode) {
        logger.error(`Code domaine: ${domainCode}`);
      }
      const wrapped = new DbConfigError(
        `Connexion PostgreSQL obligatoire impossible. Cause: ${cause}`,
      );
      wrapped.cause = error;
      if (domainCode) {
        wrapped.domainCode = domainCode;
      }
      throw wrapped;
    }

    logger.warn("PostgreSQL indisponible, démarrage en mode démo mémoire.");
    logger.warn(`Cause: ${cause}`);

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
  disableLegacyBackOfficeRuntimeMigrations,
};
