const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

/** Origine frontend production (Vercel, branche main). */
const PRODUCTION_FRONTEND_ORIGIN = "https://somafrik.app";

/**
 * @param {string} origin
 * @returns {string}
 */
function normalizeOrigin(origin) {
  return String(origin ?? "").trim().replace(/\/+$/, "");
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
 * @param {string} origin
 * @returns {boolean}
 */
function isLocalOrPrivateOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function parseConfiguredOrigins(env = process.env) {
  const rawOrigins = String(env.CORS_ORIGINS ?? "*").trim();
  return [
    ...new Set(
      rawOrigins
        .split(",")
        .map((origin) => normalizeOrigin(origin))
        .filter(Boolean),
    ),
  ];
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function resolveAllowedOrigins(env = process.env) {
  const configured = parseConfiguredOrigins(env);
  if (configured.includes("*")) return ["*"];
  if (!shouldAllowDevOrigins(env)) return configured;
  return [...new Set([...configured, ...DEV_ORIGINS])];
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function collectProductionCorsViolations(env = process.env) {
  if (env.NODE_ENV !== "production") return [];

  const violations = [];
  const configured = parseConfiguredOrigins(env);

  if (configured.length === 0 || configured.includes("*")) {
    violations.push("CORS_ORIGINS doit lister explicitement les URL de production (pas de wildcard « * »).");
    return violations;
  }

  const unsafeOrigins = configured.filter(isLocalOrPrivateOrigin);
  if (unsafeOrigins.length > 0) {
    violations.push(
      `CORS_ORIGINS contient des origines locales ou privées interdites en production: ${unsafeOrigins.join(", ")}.`,
    );
  }

  if (env.SOMAFRIK_ENV !== "preproduction" && configured.length !== 1) {
    violations.push(
      `CORS_ORIGINS doit autoriser exactement ${PRODUCTION_FRONTEND_ORIGIN} en production (une seule origine).`,
    );
  } else if (env.SOMAFRIK_ENV !== "preproduction" && configured[0] !== PRODUCTION_FRONTEND_ORIGIN) {
    violations.push(
      `CORS_ORIGINS doit valoir exactement ${PRODUCTION_FRONTEND_ORIGIN} en production (reçu: ${configured.join(", ")}).`,
    );
  }

  return violations;
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

  if (allowedOrigins.includes("*")) {
    return { origin: true };
  }

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
  normalizeOrigin,
  shouldAllowDevOrigins,
  isLocalDevOrigin,
  isLocalOrPrivateOrigin,
  parseConfiguredOrigins,
  resolveAllowedOrigins,
  collectProductionCorsViolations,
  assertProductionCors,
  buildCorsOptions,
};
