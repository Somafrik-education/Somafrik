const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

const PRODUCTION_FRONTEND_ORIGIN = "https://somafrik.app";
const PREPRODUCTION_FRONTEND_ORIGIN = "https://preprod.somafrik.app";

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveAppEnv(env = process.env) {
  const explicit = String(env.APP_ENV ?? "").trim();
  if (explicit) return explicit;
  if (env.SOMAFRIK_ENV === "preproduction") return "preproduction";
  return env.NODE_ENV === "production" ? "production" : "development";
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolvePrimaryOrigin(env = process.env) {
  if (resolveAppEnv(env) === "production") {
    return PRODUCTION_FRONTEND_ORIGIN;
  }
  return PREPRODUCTION_FRONTEND_ORIGIN;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function shouldAllowDevOrigins(env = process.env) {
  if (env.NODE_ENV === "production") return false;
  return env.CORS_ALLOW_DEV_ORIGINS !== "false";
}

/**
 * @param {string} origin
 * @returns {boolean}
 */
function isLocalDevOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function resolveAllowedOrigins(env = process.env) {
  const allowedOrigin = resolvePrimaryOrigin(env);
  if (!shouldAllowDevOrigins(env)) return [allowedOrigin];
  return [...new Set([allowedOrigin, ...DEV_ORIGINS])];
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function collectProductionCorsViolations(env = process.env) {
  if (env.NODE_ENV !== "production") return [];

  const appEnv = resolveAppEnv(env);
  if (appEnv !== "production" && appEnv !== "preproduction") {
    return [`APP_ENV doit valoir "production" ou "preproduction" (reçu: ${appEnv || "(vide)"}).`];
  }

  return [];
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function assertProductionCors(env = process.env) {
  const violations = collectProductionCorsViolations(env);
  if (violations.length === 0) return;

  throw new Error(
    `Configuration CORS de production non sécurisée:\n- ${violations.join("\n- ")}`,
  );
}

/**
 * @param {{ BusinessError: new (statusCode: number, message: string) => Error }} deps
 * @param {NodeJS.ProcessEnv} [env]
 */
function buildCorsOptions({ BusinessError }, env = process.env) {
  const allowedOrigins = resolveAllowedOrigins(env);
  const allowDevOrigins = shouldAllowDevOrigins(env);

  return {
    origin(origin, callback) {
      if (
        !origin
        || allowedOrigins.includes(origin)
        || (allowDevOrigins && isLocalDevOrigin(origin))
      ) {
        return callback(null, true);
      }

      return callback(
        new BusinessError(403, `Origine CORS non autorisée: ${origin}`),
      );
    },
  };
}

module.exports = {
  DEV_ORIGINS,
  PRODUCTION_FRONTEND_ORIGIN,
  PREPRODUCTION_FRONTEND_ORIGIN,
  resolveAppEnv,
  resolvePrimaryOrigin,
  shouldAllowDevOrigins,
  isLocalDevOrigin,
  resolveAllowedOrigins,
  collectProductionCorsViolations,
  assertProductionCors,
  buildCorsOptions,
};
