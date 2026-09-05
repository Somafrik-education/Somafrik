"use strict";

const { BusinessError } = require("../services/authService");
const { isPlatformAdminPrincipal } = require("./platformPersonalDataGuard");
const { stripSensitiveFieldsDeep } = require("./sanitizeUserForResponse");

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

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

const EXPORT_SENSITIVE_KEY_PATTERN =
  /^(password|password_hash|passwordhash|pin|pin_hash|pinhash|temporarypassword|temporarysecret|refresh_token|refresh_token_hash|refreshtoken|refreshtokenhash|jwt_secret|jwtsecret|access_token|accesstoken|database_url|db_password|postgres_password|connectionstring|secret)$/i;

const DATA_EXPORT_READ_PERMISSIONS = Object.freeze([
  "Paramètres Établissement:READ",
  "Paramètres Établissement:UPDATE",
  "Gérer planning académique",
  "ALL_PRIVILEGES",
  "COUNTRY_PRIVILEGES",
]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function isSuperAdminPrincipal(principal) {
  return SUPER_ADMIN_ROLES.has(asTrimmed(principal?.role));
}

function isCountryAdminPrincipal(principal) {
  return asTrimmed(principal?.role) === "Admin Pays";
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
