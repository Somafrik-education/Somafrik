/**
 * Configuration et validation de connexion à la base de données (S2.2).
 *
 * - Résolution DATABASE_URL ou variables discrètes (DB_* / POSTGRES_*)
 * - Validation ports / SSL / mode production
 * - Messages d'erreur sans fuite de secrets
 */

const MIN_PORT = 1;
const MAX_PORT = 65535;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

class DbConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "DbConfigError";
    this.code = "DB_CONFIG_INVALID";
  }
}

function isProductionEnvironment(env = process.env) {
  return String(env.NODE_ENV ?? "").trim() === "production";
}

function readEnv(env, ...keys) {
  for (const key of keys) {
    const value = env[key];
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function parseDatabasePort(raw, fieldName = "DB_PORT") {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new DbConfigError(
      `${fieldName} invalide : un entier entre ${MIN_PORT} et ${MAX_PORT} est requis.`,
    );
  }
  const port = Number(text);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new DbConfigError(
      `${fieldName} invalide : un entier entre ${MIN_PORT} et ${MAX_PORT} est requis.`,
    );
  }
  return port;
}

function redactDatabaseUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "[URL absente]";
  try {
    const parsed = new URL(raw);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "[URL de base de données invalide]";
  }
}

function sanitizeDbErrorMessage(error) {
  if (!error) return "Erreur de configuration ou de connexion à la base de données.";
  if (error instanceof DbConfigError) return error.message;

  let message = String(error.message ?? error);
  // Retire les URI postgres éventuelles.
  message = message.replace(
    /postgres(?:ql)?:\/\/[^\s)'"]+/gi,
    "[URL de base de données masquée]",
  );
  // Retire patterns user:password@host
  message = message.replace(
    /([^\s:/@]+):([^\s:/@]+)@([^\s:/]+)/g,
    "***:***@$3",
  );
  // Retire mots de passe explicites dans le texte.
  message = message.replace(
    /(password|mot de passe|passwd)\s*[:=]\s*\S+/gi,
    "$1=[masqué]",
  );
  return message || "Erreur de configuration ou de connexion à la base de données.";
}

function parseSslModeFromUrl(databaseUrl) {
  try {
    const parsed = new URL(String(databaseUrl ?? "").trim());
    return String(parsed.searchParams.get("sslmode") ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Résout la politique SSL à partir de l'env et/ou de sslmode dans DATABASE_URL.
 * @returns {{ enabled: boolean|null, rejectUnauthorized: boolean|null, mode: string }}
 */
function resolveSslPolicy(env = process.env, databaseUrl = "") {
  const SSL_TRUE = new Set(["true", "1", "require", "on", "yes"]);
  const SSL_FALSE = new Set(["false", "0", "disable", "off", "no"]);
  const SSL_BOOL = new Set([...SSL_TRUE, ...SSL_FALSE]);

  const sslFlag = readEnv(env, "DB_SSL", "POSTGRES_SSL", "DATABASE_SSL").toLowerCase();
  const rejectFlag = readEnv(
    env,
    "DB_SSL_REJECT_UNAUTHORIZED",
    "POSTGRES_SSL_REJECT_UNAUTHORIZED",
  ).toLowerCase();
  const sslmode = parseSslModeFromUrl(databaseUrl) || readEnv(env, "DB_SSLMODE", "PGSSLMODE").toLowerCase();

  if (sslFlag && !SSL_BOOL.has(sslFlag)) {
    throw new DbConfigError("DB_SSL contient une valeur invalide.");
  }
  if (rejectFlag && !SSL_BOOL.has(rejectFlag)) {
    throw new DbConfigError("DB_SSL_REJECT_UNAUTHORIZED contient une valeur invalide.");
  }

  let enabled = null;
  if (SSL_TRUE.has(sslFlag)) enabled = true;
  if (SSL_FALSE.has(sslFlag)) enabled = false;

  if (sslmode) {
    if (["disable", "allow"].includes(sslmode)) {
      if (enabled === true) {
        throw new DbConfigError(
          "Configuration SSL incohérente : SSL activé alors que sslmode=disable/allow.",
        );
      }
      enabled = false;
    } else if (["require", "verify-ca", "verify-full"].includes(sslmode)) {
      if (enabled === false) {
        throw new DbConfigError(
          "Configuration SSL incohérente : SSL désactivé alors que sslmode exige une connexion sécurisée.",
        );
      }
      enabled = true;
    } else {
      throw new DbConfigError(
        "Configuration SSL invalide : sslmode non supporté (disable, require, verify-ca, verify-full).",
      );
    }
  }

  let rejectUnauthorized = null;
  if (SSL_TRUE.has(rejectFlag)) rejectUnauthorized = true;
  if (SSL_FALSE.has(rejectFlag)) rejectUnauthorized = false;

  if (sslmode === "verify-full" || sslmode === "verify-ca") {
    if (rejectUnauthorized === false) {
      throw new DbConfigError(
        "Configuration SSL incohérente : verify-ca/verify-full exige la vérification du certificat.",
      );
    }
    rejectUnauthorized = true;
  }

  return {
    enabled,
    rejectUnauthorized: rejectUnauthorized === null ? (enabled ? true : null) : rejectUnauthorized,
    mode: sslmode || (enabled === true ? "require" : enabled === false ? "disable" : ""),
  };
}

function buildPoolSslOption(sslPolicy) {
  if (sslPolicy.enabled !== true) return undefined;
  return {
    rejectUnauthorized: sslPolicy.rejectUnauthorized !== false,
  };
}

function isMemoryFallbackAllowed(env = process.env) {
  if (isProductionEnvironment(env)) return false;
  return env.SOMAFRIK_DB_REQUIRED === "false";
}

function isDatabaseRequired(env = process.env) {
  if (isProductionEnvironment(env)) return true;
  if (env.SOMAFRIK_DB_REQUIRED === "false") return false;
  if (env.SOMAFRIK_DB_REQUIRED === "true") return true;
  // Développement : PostgreSQL requis par défaut s'il n'est pas explicitement désactivé.
  return true;
}

/**
 * Résout la configuration effective (sans secrets dans les messages d'erreur).
 * @returns {{
 *   connectionString: string,
 *   host: string,
 *   port: number,
 *   user: string,
 *   database: string,
 *   ssl: object|undefined,
 *   source: "DATABASE_URL"|"DISCRETE",
 *   redactedConnectionString: string,
 * }}
 */
function resolveDatabaseConfig(env = process.env) {
  const databaseUrl = readEnv(env, "DATABASE_URL");
  const sslPolicy = resolveSslPolicy(env, databaseUrl);

  if (databaseUrl) {
    let parsed;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      throw new DbConfigError("DATABASE_URL est invalide.");
    }
    if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
      throw new DbConfigError("DATABASE_URL doit utiliser le protocole postgresql.");
    }
    const port = parseDatabasePort(parsed.port || "5432", "DATABASE_URL.port");
    const user = decodeURIComponent(parsed.username || "");
    const password = decodeURIComponent(parsed.password || "");
    const database = decodeURIComponent((parsed.pathname || "").replace(/^\//, ""));
    const host = parsed.hostname || "";

    if (!host) throw new DbConfigError("DATABASE_URL : hôte manquant.");
    if (!user) throw new DbConfigError("DATABASE_URL : utilisateur manquant.");
    if (!password) throw new DbConfigError("DATABASE_URL : mot de passe manquant.");
    if (!database) throw new DbConfigError("DATABASE_URL : nom de base manquant.");

    const ssl = buildPoolSslOption(sslPolicy);
    return {
      connectionString: databaseUrl,
      host,
      port,
      user,
      database,
      ssl,
      source: "DATABASE_URL",
      redactedConnectionString: redactDatabaseUrl(databaseUrl),
      poolConfig: {
        connectionString: databaseUrl,
        ...(ssl ? { ssl } : {}),
      },
    };
  }

  const user = readEnv(env, "DB_USER", "POSTGRES_USER");
  const password = readEnv(env, "DB_PASSWORD", "POSTGRES_PASSWORD");
  const host = readEnv(env, "DB_HOST", "POSTGRES_HOST");
  const database = readEnv(env, "DB_NAME", "POSTGRES_DB");
  const portRaw = readEnv(env, "DB_PORT", "POSTGRES_PORT") || "5432";
  const port = parseDatabasePort(portRaw, readEnv(env, "DB_PORT") ? "DB_PORT" : "POSTGRES_PORT");

  const missing = [];
  if (!host) missing.push("DB_HOST/POSTGRES_HOST");
  if (!user) missing.push("DB_USER/POSTGRES_USER");
  if (!password) missing.push("DB_PASSWORD/POSTGRES_PASSWORD");
  if (!database) missing.push("DB_NAME/POSTGRES_DB");
  if (missing.length) {
    throw new DbConfigError(
      `Configuration de base de données incomplète : ${missing.join(", ")} manquant(s). ` +
        "Fournissez DATABASE_URL ou l'ensemble des variables discrètes.",
    );
  }

  const connectionString =
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${encodeURIComponent(database)}`;
  const ssl = buildPoolSslOption(sslPolicy);

  return {
    connectionString,
    host,
    port,
    user,
    database,
    ssl,
    source: "DISCRETE",
    redactedConnectionString: redactDatabaseUrl(connectionString),
    poolConfig: {
      connectionString,
      ...(ssl ? { ssl } : {}),
    },
  };
}

/**
 * @deprecated Préférez resolveDatabaseConfig(). Conservé pour compatibilité scripts.
 */
function buildDatabaseUrl(env = process.env) {
  return resolveDatabaseConfig(env).connectionString;
}

/**
 * @deprecated Préférez resolveDatabaseConfig(). Conservé pour compatibilité scripts.
 */
function resolveDatabaseUrl(env = process.env) {
  return resolveDatabaseConfig(env).connectionString;
}

function collectDatabaseConfigViolations(env = process.env) {
  const violations = [];
  const nodeEnv = String(env.NODE_ENV ?? "").trim();
  if (nodeEnv && !["development", "test", "production"].includes(nodeEnv)) {
    violations.push("NODE_ENV invalide (valeurs autorisées : development, test, production).");
  }

  const production = isProductionEnvironment(env);

  if (production && env.SOMAFRIK_DB_REQUIRED === "false") {
    violations.push("SOMAFRIK_DB_REQUIRED=false est interdit en production (aucun fallback mémoire).");
  }

  if (production && env.SOMAFRIK_SKIP_DEMO_SEED !== "true") {
    violations.push("SOMAFRIK_SKIP_DEMO_SEED=true est obligatoire en production (aucun seed automatique).");
  }

  // Valider les ports même s'ils sont optionnels.
  for (const [field, value] of [
    ["DB_PORT", env.DB_PORT],
    ["POSTGRES_PORT", env.POSTGRES_PORT],
    ["PORT", env.PORT],
  ]) {
    if (value == null || String(value).trim() === "") continue;
    try {
      parseDatabasePort(value, field);
    } catch (error) {
      violations.push(sanitizeDbErrorMessage(error));
    }
  }

  // SSL toujours validé s'il est présent (y compris hors production / mode mémoire).
  try {
    resolveSslPolicy(env, readEnv(env, "DATABASE_URL"));
  } catch (error) {
    violations.push(sanitizeDbErrorMessage(error));
  }

  if (isMemoryFallbackAllowed(env)) {
    return violations;
  }

  try {
    const config = resolveDatabaseConfig(env);
    if (production && LOCAL_HOSTS.has(String(config.host).toLowerCase())) {
      violations.push(
        "Hôte de base de données local interdit en production (localhost / 127.0.0.1).",
      );
    }
  } catch (error) {
    violations.push(sanitizeDbErrorMessage(error));
  }

  return violations;
}

function assertDatabaseConfiguration(env = process.env) {
  const violations = collectDatabaseConfigViolations(env);
  if (violations.length === 0) return;
  throw new DbConfigError(
    `Configuration de base de données invalide :\n- ${violations.join("\n- ")}`,
  );
}

module.exports = {
  MIN_PORT,
  MAX_PORT,
  DbConfigError,
  isProductionEnvironment,
  isMemoryFallbackAllowed,
  isDatabaseRequired,
  parseDatabasePort,
  redactDatabaseUrl,
  sanitizeDbErrorMessage,
  resolveSslPolicy,
  resolveDatabaseConfig,
  buildDatabaseUrl,
  resolveDatabaseUrl,
  collectDatabaseConfigViolations,
  assertDatabaseConfiguration,
};
