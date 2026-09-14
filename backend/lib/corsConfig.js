const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

const PRODUCTION_FRONTEND_ORIGIN = "https://somafrik.app";
const PREPRODUCTION_FRONTEND_ORIGIN = "https://preprod.somafrik.app";
const DEMO_FRONTEND_ORIGIN = "https://demo.somafrik.app";
const DEMO_ENTRY_ORIGIN = PRODUCTION_FRONTEND_ORIGIN;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveAppEnv(env = process.env) {
  const explicit = String(env.APP_ENV ?? "").trim();
  if (explicit) return explicit;
  if (env.SOMAFRIK_ENV === "preproduction") return "preproduction";
  if (env.SOMAFRIK_ENV === "demo") return "demo";
  return env.NODE_ENV === "production" ? "production" : "development";
}

function normalizedOrigin(value, fallback) {
  return String(value ?? fallback).trim().replace(/\/$/, "");
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveDemoFrontendOrigin(env = process.env) {
  return normalizedOrigin(env.DEMO_FRONTEND_ORIGIN, DEMO_FRONTEND_ORIGIN);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveDemoEntryOrigin(env = process.env) {
  return normalizedOrigin(env.DEMO_ENTRY_ORIGIN, DEMO_ENTRY_ORIGIN);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolvePrimaryOrigin(env = process.env) {
  const appEnv = resolveAppEnv(env);
  if (appEnv === "production") {
    return PRODUCTION_FRONTEND_ORIGIN;
  }
  if (appEnv === "demo") {
    return resolveDemoFrontendOrigin(env);
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
  const appEnv = resolveAppEnv(env);
  const environmentOrigins =
    appEnv === "demo"
      ? [resolveDemoFrontendOrigin(env), resolveDemoEntryOrigin(env)]
      : [resolvePrimaryOrigin(env)];
  if (!shouldAllowDevOrigins(env)) return [...new Set(environmentOrigins)];
  return [...new Set([...environmentOrigins, ...DEV_ORIGINS])];
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function collectProductionCorsViolations(env = process.env) {
  if (env.NODE_ENV !== "production") return [];

  const appEnv = resolveAppEnv(env);
  if (!["production", "preproduction", "demo"].includes(appEnv)) {
    return [
      `APP_ENV doit valoir "production", "preproduction" ou "demo" (reçu: ${appEnv || "(vide)"}).`,
    ];
  }

  if (appEnv === "demo") {
    const demoFrontend = resolveDemoFrontendOrigin(env);
    const demoEntry = resolveDemoEntryOrigin(env);
    const violations = [];
    if (!isHttpsOrigin(demoFrontend)) {
      violations.push("DEMO_FRONTEND_ORIGIN doit être une origine HTTPS valide.");
    }
    if (!isHttpsOrigin(demoEntry)) {
      violations.push("DEMO_ENTRY_ORIGIN doit être une origine HTTPS valide.");
    }
    if ([PRODUCTION_FRONTEND_ORIGIN, PREPRODUCTION_FRONTEND_ORIGIN].includes(demoFrontend)) {
      violations.push("DEMO_FRONTEND_ORIGIN doit rester distinct de PROD/PREPROD.");
    }
    return violations;
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
  DEMO_FRONTEND_ORIGIN,
  DEMO_ENTRY_ORIGIN,
  resolveAppEnv,
  resolvePrimaryOrigin,
  resolveDemoFrontendOrigin,
  resolveDemoEntryOrigin,
  shouldAllowDevOrigins,
  isLocalDevOrigin,
  resolveAllowedOrigins,
  collectProductionCorsViolations,
  assertProductionCors,
  buildCorsOptions,
};
