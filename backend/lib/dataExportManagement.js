"use strict";

const { BusinessError } = require("../services/authService");
const { isPlatformAdminPrincipal } = require("./platformPersonalDataGuard");
const { stripSensitiveFieldsDeep } = require("./sanitizeUserForResponse");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");

const DATA_EXPORT_FORMAT = "somafrik-export";
const DATA_EXPORT_VERSION = 1;
/** Snapshot consistency = PostgreSQL REPEATABLE READ (transaction READ ONLY). */
const DATA_EXPORT_SNAPSHOT_ISOLATION = "REPEATABLE READ";
const DATA_EXPORT_SNAPSHOT_ACCESS_MODE = "READ ONLY";

const DATA_EXPORT_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
  SCHOOL_REQUIRED: "SCHOOL_REQUIRED",
  SCHOOL_NOT_FOUND: "SCHOOL_NOT_FOUND",
});

const EXPORT_SENSITIVE_KEY_PATTERN =
  /^(password|password_hash|passwordhash|pin|pin_hash|pinhash|temporarypassword|temporarysecret|refresh_token|refresh_token_hash|refreshtoken|refreshtokenhash|jwt_secret|jwtsecret|access_token|accesstoken|database_url|db_password|postgres_password|connectionstring|secret)$/i;

const DATA_EXPORT_READ_PERMISSIONS = Object.freeze([
  "Paramètres Établissement:READ",
  "Paramètres Établissement:UPDATE",
]);

const SCHOOL_ADMIN_ROLE_LABELS = Object.freeze(["Admin School"]);
const SCHOOL_ADMIN_ROLE_KEYS = Object.freeze(["SCHOOL_ADMIN"]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function isCountryAdminPrincipal(principal) {
  return asTrimmed(principal?.role) === "Admin Pays";
}

function pushRoleToken(tokens, value) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number") {
    tokens.push(asTrimmed(value));
  }
}

function collectPrincipalRoleTokens(principal) {
  const tokens = [];
  pushRoleToken(tokens, principal?.role);
  pushRoleToken(tokens, principal?.roleKey);
  pushRoleToken(tokens, principal?.role_key);
  if (Array.isArray(principal?.roleKeys)) {
    for (const item of principal.roleKeys) pushRoleToken(tokens, item);
  }
  return tokens.filter(Boolean);
}

function isSchoolAdminPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) return false;
  return collectPrincipalRoleTokens(principal).some((token) => {
    if (SCHOOL_ADMIN_ROLE_LABELS.includes(token)) return true;
    return SCHOOL_ADMIN_ROLE_KEYS.includes(token.toUpperCase());
  });
}

function hasConcreteSchoolScope(principal) {
  const schoolCode = asTrimmed(principal?.schoolCode).toUpperCase();
  return Boolean(schoolCode) && schoolCode !== "*";
}

function principalHasAnyPermission(principal, allowed) {
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  return allowed.some((key) => permissions.includes(key));
}

function createDataExportError(status, message, code, details) {
  const error = new BusinessError(status, message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function assertDataExportRead(principal) {
  if (isPlatformAdminPrincipal(principal) || isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    throw createDataExportError(403, "Accès refusé à l'export des données.", DATA_EXPORT_ERROR.FORBIDDEN);
  }
  if (!isSchoolAdminPrincipal(principal)) {
    throw createDataExportError(403, "Accès refusé à l'export des données.", DATA_EXPORT_ERROR.FORBIDDEN);
  }
  if (!hasConcreteSchoolScope(principal)) {
    throw createDataExportError(403, "Accès refusé à l'export des données.", DATA_EXPORT_ERROR.FORBIDDEN);
  }
  if (principalHasAnyPermission(principal, DATA_EXPORT_READ_PERMISSIONS)) return;
  throw createDataExportError(403, "Accès refusé à l'export des données.", DATA_EXPORT_ERROR.FORBIDDEN);
}

/**
 * Résout l'établissement exporté.
 * Admin School : JWT uniquement (le schoolCode query est ignoré).
 * Admin Pays / Superadmin : schoolCode explicite obligatoire, puis assertSchoolAccess.
 */
function resolveExportSchoolCode(principal, requestedSchoolCode) {
  const requested = asTrimmed(requestedSchoolCode).toUpperCase();
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    if (!requested || requested === "*") {
      throw createDataExportError(
        400,
        "schoolCode établissement requis.",
        DATA_EXPORT_ERROR.SCHOOL_REQUIRED,
      );
    }
    return requested;
  }
  const jwtSchool = asTrimmed(principal?.schoolCode).toUpperCase();
  if (!jwtSchool || jwtSchool === "*") {
    throw createDataExportError(
      400,
      "schoolCode établissement requis.",
      DATA_EXPORT_ERROR.SCHOOL_REQUIRED,
    );
  }
  return jwtSchool;
}

function isSensitiveExportKey(key) {
  const compact = String(key ?? "").replace(/[\s_-]/g, "");
  return EXPORT_SENSITIVE_KEY_PATTERN.test(String(key ?? "")) || EXPORT_SENSITIVE_KEY_PATTERN.test(compact);
}

function sanitizeExportValue(value) {
  const stripped = stripSensitiveFieldsDeep(value);
  return sanitizeExportKeysDeep(stripped);
}

function sanitizeExportKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeExportKeysDeep(item));
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveExportKey(key)) continue;
    next[key] = sanitizeExportKeysDeep(nested);
  }
  return next;
}

function collectSensitiveExportPaths(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitiveExportPaths(item, `${prefix}[${index}]`));
  }
  if (value == null || typeof value !== "object") return [];
  const leaks = [];
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isSensitiveExportKey(key)) leaks.push(path);
    leaks.push(...collectSensitiveExportPaths(nested, path));
  }
  return leaks;
}

function buildExportEnvelope({ schoolCode, domains, generatedAt = new Date().toISOString() }) {
  const includedDomains = Object.keys(domains).filter((key) => domains[key] !== undefined);
  const payload = {
    format: DATA_EXPORT_FORMAT,
    version: DATA_EXPORT_VERSION,
    generatedAt,
    schoolCode,
    includedDomains,
    domains: Object.fromEntries(includedDomains.map((key) => [key, domains[key]])),
  };
  return sanitizeExportValue(payload);
}

function dataExportAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

module.exports = {
  DATA_EXPORT_FORMAT,
  DATA_EXPORT_VERSION,
  DATA_EXPORT_SNAPSHOT_ISOLATION,
  DATA_EXPORT_SNAPSHOT_ACCESS_MODE,
  DATA_EXPORT_ERROR,
  DATA_EXPORT_READ_PERMISSIONS,
  assertDataExportRead,
  resolveExportSchoolCode,
  sanitizeExportValue,
  collectSensitiveExportPaths,
  buildExportEnvelope,
  dataExportAuditMetaFromRequest,
  isSuperAdminPrincipal,
};
