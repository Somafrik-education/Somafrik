/**
 * Démarre le backend sans PostgreSQL (données en mémoire, rechargées à chaque run).
 * Usage: npm run dev:memory
 *
 * Contrat strict : le mode mémoire ne doit jamais hériter d'une configuration
 * PostgreSQL du shell / de la CI. Sinon SOMAFRIK_DB_REQUIRED=false autorise le
 * fallback, mais initializeRepository tente quand même la base configurée avant
 * de basculer en mémoire.
 */
const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_SSL",
  "DB_SSLMODE",
  "DB_SSL_REJECT_UNAUTHORIZED",
  "DB_POOL_MAX",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "POSTGRES_SSL",
  "POSTGRES_SSL_REJECT_UNAUTHORIZED",
  "DATABASE_SSL",
  "PGSSLMODE",
];

function forceMemoryEnvironment(env = process.env) {
  for (const key of DATABASE_ENV_KEYS) {
    delete env[key];
  }
  env.SOMAFRIK_DB_REQUIRED = "false";
  env.NODE_ENV = env.NODE_ENV ?? "development";
  return env;
}

if (require.main === module) {
  forceMemoryEnvironment(process.env);
  require("../server.js");
}

module.exports = {
  DATABASE_ENV_KEYS,
  forceMemoryEnvironment,
};
