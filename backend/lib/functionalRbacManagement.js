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

function assertNotProtectedArchive(roleKey) {
  const key = String(toRoleKey(roleKey) || "").toUpperCase();
  if (PROTECTED_SYSTEM_ROLE_KEYS.has(key)) {
    throw createFunctionalRbacError(
      403,
      "Les rôles plateforme SUPER_ADMIN / COUNTRY_ADMIN / SCHOOL_ADMIN ne peuvent pas être archivés.",
      FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
    );
  }
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
 * Deux écritures dans la même ms doivent quand même avancer le jeton,
 * sinon un expectedUpdatedAt périmé est accepté (lost update).
 */
function nextMonotonicUpdatedAt(previous, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const prevMs = previous ? new Date(previous).getTime() : Number.NaN;
  if (Number.isFinite(prevMs) && nowMs <= prevMs) {
    return new Date(prevMs + 1).toISOString();
  }
  return new Date(nowMs).toISOString();
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

module.exports = {
  FUNCTIONAL_RBAC_ERROR,
  LEGACY_ROLE_PERMISSIONS_WRITE_CODE,
  LEGACY_ROLE_PERMISSIONS_WRITE_MESSAGE,
  PROTECTED_SYSTEM_ROLE_KEYS,
  SUPER_ADMIN_INVARIANT_MODULES,
  createFunctionalRbacError,
  throwLegacyRolePermissionsWrite,
  normalizeScope,
  assertNotProtectedArchive,
  assertSuperAdminInvariantPatch,
  timestampsEqual,
  nextMonotonicUpdatedAt,
  looksLikeUuid,
};
