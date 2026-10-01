"use strict";

const { asTrimmed, createEstablishmentRolesError } = require("./establishmentRolesManagement");
const { toRoleKey } = require("./userRoleLifecycle");

const FUNCTIONAL_RBAC_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  INVALID_SCOPE: "INVALID_SCOPE",
  INVALID_MODULE: "INVALID_MODULE",
  INVALID_ROLE: "INVALID_ROLE",
  ROLE_ARCHIVED: "ROLE_ARCHIVED",
  ROLE_PROTECTED: "ROLE_PROTECTED",
  SUPER_ADMIN_INVARIANT: "SUPER_ADMIN_INVARIANT",
  MANDATORY_PERMISSION: "MANDATORY_PERMISSION",
  CONFLICT: "CONFLICT",
  LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN: "LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN",
});

const LEGACY_ROLE_PERMISSIONS_WRITE_CODE = FUNCTIONAL_RBAC_ERROR.LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN;
const LEGACY_ROLE_PERMISSIONS_WRITE_MESSAGE =
  "La matrice globale JSONB n'est plus modifiable via PUT /api/backoffice/role-permissions. Utilisez PATCH /api/backoffice/rbac/permissions.";

const PROTECTED_SYSTEM_ROLE_KEYS = new Set(["SUPER_ADMIN", "COUNTRY_ADMIN", "SCHOOL_ADMIN"]);

const RBAC_AUDIT_ACTIONS = Object.freeze({
  ROLE_CREATE: "ROLE_CREATE",
  ROLE_RENAME: "ROLE_RENAME",
  ROLE_ARCHIVE: "ROLE_ARCHIVE",
  PERMISSION_OVERRIDE_CREATE_OR_UPDATE: "PERMISSION_OVERRIDE_CREATE_OR_UPDATE",
  PERMISSION_OVERRIDE_RESET: "PERMISSION_OVERRIDE_RESET",
  ROLE_DISPLAY_LABEL_UPDATE: "ROLE_DISPLAY_LABEL_UPDATE",
  ROLE_DISPLAY_LABEL_RESET: "ROLE_DISPLAY_LABEL_RESET",
});

const RBAC_HISTORY_ACTIONS = Object.freeze([
  RBAC_AUDIT_ACTIONS.ROLE_CREATE,
  RBAC_AUDIT_ACTIONS.ROLE_RENAME,
  RBAC_AUDIT_ACTIONS.ROLE_ARCHIVE,
  RBAC_AUDIT_ACTIONS.PERMISSION_OVERRIDE_CREATE_OR_UPDATE,
  RBAC_AUDIT_ACTIONS.PERMISSION_OVERRIDE_RESET,
  RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_UPDATE,
  RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_RESET,
  "ROLE_CREATED",
  "ROLE_UPDATED",
  "ROLE_ARCHIVED",
  "ROLE_PERMISSION_MATRIX_UPDATED",
  "ROLE_PERMISSION_OVERRIDE_RESET",
  "ROLE_PERMISSION_GRANTED",
  "ROLE_PERMISSION_REVOKED",
]);

const RBAC_HISTORY_DEFAULT_LIMIT = 20;
const RBAC_HISTORY_MAX_LIMIT = 50;

const FORBIDDEN_AUDIT_KEYS = new Set([
  "jwt",
  "token",
  "password",
  "pin",
  "secret",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "access_token",
  "refresh_token",
  "idtoken",
  "id_token",
]);

/** Invariants Superadmin — jamais retirables, même via la matrice. */
const SUPER_ADMIN_INVARIANT_MODULES = Object.freeze({
  role_permissions: { canCreate: false, canRead: true, canUpdate: true, canDelete: false },
  users: { canCreate: true, canRead: true, canUpdate: true, canDelete: true },
  countries: { canCreate: true, canRead: true, canUpdate: true, canDelete: false },
  schools: { canCreate: true, canRead: true, canUpdate: true, canDelete: false },
  education_reference: { canCreate: true, canRead: true, canUpdate: true, canDelete: false },
});

function createFunctionalRbacError(status, message, code, details) {
  const error = createEstablishmentRolesError(status, message, code || FUNCTIONAL_RBAC_ERROR.FORBIDDEN, details);
  error.code = code || FUNCTIONAL_RBAC_ERROR.FORBIDDEN;
  return error;
}

function throwLegacyRolePermissionsWrite() {
  throw createFunctionalRbacError(
    403,
    LEGACY_ROLE_PERMISSIONS_WRITE_MESSAGE,
    LEGACY_ROLE_PERMISSIONS_WRITE_CODE,
  );
}

function normalizeScope({ scopeType, countryId, schoolId, countryCode, schoolCode }) {
  const school = asTrimmed(schoolId || schoolCode);
  const country = asTrimmed(countryId || countryCode);
  if (asTrimmed(scopeType) === "school" || school) {
    if (!school) {
      throw createFunctionalRbacError(400, "school_id obligatoire pour une portée établissement.", FUNCTIONAL_RBAC_ERROR.INVALID_SCOPE);
    }
    return { scopeType: "school", countryId: country || null, schoolId: school };
  }
  if (asTrimmed(scopeType) === "country" || (country && !school)) {
    if (!country) {
      throw createFunctionalRbacError(400, "country_id obligatoire pour une portée pays.", FUNCTIONAL_RBAC_ERROR.INVALID_SCOPE);
    }
    return { scopeType: "country", countryId: country, schoolId: null };
  }
  return { scopeType: "global", countryId: null, schoolId: null };
}

function isProtectedSystemRole(roleKey) {
  const key = String(toRoleKey(roleKey) || "").toUpperCase();
  return PROTECTED_SYSTEM_ROLE_KEYS.has(key);
}

function assertNotProtectedMutation(roleKey, mutation = "modifiés") {
  if (isProtectedSystemRole(roleKey)) {
    throw createFunctionalRbacError(
      403,
      `Les rôles plateforme SUPER_ADMIN / COUNTRY_ADMIN / SCHOOL_ADMIN ne peuvent pas être ${mutation}.`,
      FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
    );
  }
}

function assertNotProtectedArchive(roleKey) {
  assertNotProtectedMutation(roleKey, "archivés");
}

function looksLikeJwt(value) {
  return typeof value === "string" && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value.trim());
}

function sanitizeRbacAuditValue(value, depth = 0) {
  if (value == null || typeof value !== "object") {
    return looksLikeJwt(value) ? "[redacted]" : value;
  }
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeRbacAuditValue(item, depth + 1));
  }
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_AUDIT_KEYS.has(String(key).toLowerCase())) continue;
    out[key] = sanitizeRbacAuditValue(nested, depth + 1);
  }
  return out;
}

function rbacAuditActor(principal) {
  return {
    actor: asTrimmed(principal?.identifier || principal?.sub || principal?.id) || null,
    actorRole: asTrimmed(principal?.role) || null,
  };
}

function clampRbacHistoryLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return RBAC_HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), RBAC_HISTORY_MAX_LIMIT);
}

function clampRbacHistoryOffset(rawOffset) {
  const parsed = Number(rawOffset);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function assertSuperAdminInvariantPatch(roleKey, grants = []) {
  const { assertMandatoryPermissionPatch } = require("./rbacMandatoryPermissions");
  assertMandatoryPermissionPatch(roleKey, grants);
}

function timestampsEqual(left, right) {
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}

/**
 * Jeton OCC aligné sur Date.getTime() (milliseconde JSON).
 * Le previous DOIT être le MAX(updated_at) du scope, pas la ligne patchée.
 */
function nextMonotonicUpdatedAt(previous, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const prevMs = previous ? new Date(previous).getTime() : Number.NaN;
  if (Number.isFinite(prevMs) && nowMs <= prevMs) {
    return new Date(prevMs + 1).toISOString();
  }
  return new Date(nowMs).toISOString();
}

function functionalRbacScopeLockKey({ roleKey, scopeType, countryId, schoolId } = {}) {
  return [
    String(roleKey || "").toUpperCase(),
    String(scopeType || ""),
    String(countryId || ""),
    String(schoolId || ""),
  ].join("|");
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

module.exports = {
  FUNCTIONAL_RBAC_ERROR,
  LEGACY_ROLE_PERMISSIONS_WRITE_CODE,
  LEGACY_ROLE_PERMISSIONS_WRITE_MESSAGE,
  PROTECTED_SYSTEM_ROLE_KEYS,
  RBAC_AUDIT_ACTIONS,
  RBAC_HISTORY_ACTIONS,
  RBAC_HISTORY_DEFAULT_LIMIT,
  RBAC_HISTORY_MAX_LIMIT,
  SUPER_ADMIN_INVARIANT_MODULES,
  createFunctionalRbacError,
  throwLegacyRolePermissionsWrite,
  normalizeScope,
  isProtectedSystemRole,
  assertNotProtectedMutation,
  assertNotProtectedArchive,
  sanitizeRbacAuditValue,
  rbacAuditActor,
  clampRbacHistoryLimit,
  clampRbacHistoryOffset,
  assertSuperAdminInvariantPatch,
  timestampsEqual,
  nextMonotonicUpdatedAt,
  functionalRbacScopeLockKey,
  looksLikeUuid,
};
