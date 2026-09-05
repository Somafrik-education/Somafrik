"use strict";

const { ROLE_TO_DB, ROLE_FROM_DB, asTrimmed, createClientsError, CLIENTS_ERROR } = require("./clientsManagement");
const { mergeRolePermissions } = require("./rolePermissionsResolution");

/** Libellé d'accès vide. Ne pas l'utiliser comme type métier (voir businessProfileLabel / accountKind). */
const UNAFFECTED_LABEL = "Sans affectation";

const USER_ROLE_ERROR = Object.freeze({
  ...CLIENTS_ERROR,
  CLIENT_IDENTITY_FIELD_FORBIDDEN: "CLIENT_IDENTITY_FIELD_FORBIDDEN",
  ROLE_NOT_ALLOWED_ON_CREATE: "ROLE_NOT_ALLOWED_ON_CREATE",
  ROLE_NOT_ALLOWED_ON_PATCH: "ROLE_NOT_ALLOWED_ON_PATCH",
  ROLE_UNKNOWN: "ROLE_UNKNOWN",
  ROLE_INACTIVE: "ROLE_INACTIVE",
  ROLE_FORBIDDEN: "ROLE_FORBIDDEN",
  ROLE_ALREADY_GRANTED: "ROLE_ALREADY_GRANTED",
  ROLE_NOT_GRANTED: "ROLE_NOT_GRANTED",
  AUTO_GRANT_FORBIDDEN: "AUTO_GRANT_FORBIDDEN",
  PLATFORM_ROLE_FORBIDDEN: "PLATFORM_ROLE_FORBIDDEN",
  PARENT_ROLE_FORBIDDEN: "PARENT_ROLE_FORBIDDEN",
  STUDENT_ROLE_FORBIDDEN: "STUDENT_ROLE_FORBIDDEN",
  TEACHER_REVOKE_BLOCKED_ACTIVE_ASSIGNMENTS: "TEACHER_REVOKE_BLOCKED_ACTIVE_ASSIGNMENTS",
  TEACHER_PROFILE_AMBIGUOUS: "TEACHER_PROFILE_AMBIGUOUS",
  BUSINESS_PROFILE_CONFLICT: "BUSINESS_PROFILE_CONFLICT",
  USER_CODE_CONFLICT: "USER_CODE_CONFLICT",
  REPLACE_ROLES_FORBIDDEN: "REPLACE_ROLES_FORBIDDEN",
});

const FORBIDDEN_CREATE_KEYS = Object.freeze([
  "id",
  "publicId",
  "userCode",
  "user_code",
  "userId",
  "user_id",
  "role",
  "roles",
  "secondaryRoles",
  "permissions",
]);

const FORBIDDEN_IDENTITY_PATCH_KEYS = Object.freeze([
  "id",
  "publicId",
  "userCode",
  "user_code",
  "userId",
  "user_id",
  "role",
  "roles",
  "secondaryRoles",
  "permissions",
]);

/** Hiérarchie d'affichage uniquement — jamais source de permissions. */
const ROLE_PRIVILEGE_ORDER = Object.freeze([
  "SUPER_ADMIN",
  "COUNTRY_ADMIN",
  "SCHOOL_ADMIN",
  "PROVISEUR",
  "PRINCIPAL",
  "PREFET_ETUDES",
  "ACCOUNTANT",
  "SECRETARY",
  "SUPERVISOR",
  "TEACHER",
  "PARENT",
  "STUDENT",
]);

const PLATFORM_ROLE_KEYS = Object.freeze(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
const SCHOOL_PLATFORM_ROLE_KEYS = Object.freeze(["SCHOOL_ADMIN"]);
const FORBIDDEN_ASSIGN_ROLE_KEYS = Object.freeze(["PARENT", "STUDENT"]);

const ROLE_LABEL_ALIASES = Object.freeze({
  "Proviseur / Directeur": "PRINCIPAL",
  Directeur: "PRINCIPAL",
  Proviseur: "PROVISEUR",
  "Élève / Etudiant": "STUDENT",
});

const ROLE_CODE_ALIASES = Object.freeze({
  ELEVE_ETUDIANT: "STUDENT",
  ELEVE: "STUDENT",
  ETUDIANT: "STUDENT",
  PREFET_DES_ETUDES: "PREFET_ETUDES",
  ENSEIGNANT: "TEACHER",
  SECRETAIRE: "SECRETARY",
  COMPTABLE: "ACCOUNTANT",
  SURVEILLANT: "SUPERVISOR",
  DIRECTEUR: "PRINCIPAL",
});

function createUserRoleError(status, message, code, details) {
  return createClientsError(status, message, code, details);
}

function toRoleKey(role) {
  const trimmed = asTrimmed(role);
  if (!trimmed) return "";
  if (ROLE_LABEL_ALIASES[trimmed]) return ROLE_LABEL_ALIASES[trimmed];
  if (ROLE_TO_DB[trimmed]) return ROLE_TO_DB[trimmed];
  const upper = trimmed.toUpperCase().replace(/\s+/g, "_");
  if (ROLE_CODE_ALIASES[upper]) return ROLE_CODE_ALIASES[upper];
  if (ROLE_FROM_DB[upper]) return upper;
  if (ROLE_FROM_DB[trimmed]) return trimmed;
  return upper;
}

function toRoleLabel(roleKey) {
  const key = toRoleKey(roleKey);
  if (!key) return "";
  return ROLE_FROM_DB[key] ?? key;
}

function privilegeRank(roleKey) {
  const index = ROLE_PRIVILEGE_ORDER.indexOf(toRoleKey(roleKey));
  return index < 0 ? ROLE_PRIVILEGE_ORDER.length + 1 : index;
}

function sortRoleKeysByPrivilege(roleKeys = []) {
  return [...new Set(roleKeys.map(toRoleKey).filter(Boolean))].sort(
    (left, right) => privilegeRank(left) - privilegeRank(right) || left.localeCompare(right),
  );
}

function sortRoleLabelsByPrivilege(labels = []) {
  return sortRoleKeysByPrivilege(labels.map(toRoleKey)).map(toRoleLabel);
}

function primaryRoleKey(roleKeys = []) {
  const sorted = sortRoleKeysByPrivilege(roleKeys);
  return sorted[0] || "";
}

function displayRoles(roleKeys = []) {
  const sorted = sortRoleKeysByPrivilege(roleKeys);
  if (!sorted.length) {
    return {
      role: UNAFFECTED_LABEL,
      roles: [],
      roleKeys: [],
      assignmentStatus: UNAFFECTED_LABEL,
    };
  }
  const labels = sorted.map(toRoleLabel);
  return {
    role: labels[0],
    roles: labels,
    roleKeys: sorted,
    assignmentStatus: labels.join(", "),
  };
}

function principalRoleList(principal) {
  if (!principal) return [];
  if (Array.isArray(principal.roles) && principal.roles.length) {
    return principal.roles.map(toRoleLabel).filter(Boolean);
  }
  if (Array.isArray(principal.roleKeys) && principal.roleKeys.length) {
    return principal.roleKeys.map(toRoleLabel).filter(Boolean);
  }
  const single = toRoleLabel(principal.role);
  return single && single !== UNAFFECTED_LABEL ? [single] : [];
}

function principalHasRole(principal, role) {
  const wanted = toRoleLabel(role);
  if (!wanted) return false;
  return principalRoleList(principal).some((label) => label === wanted || toRoleKey(label) === toRoleKey(wanted));
}

function principalHasAnyRole(principal, roleSet) {
  if (!roleSet) return false;
  return principalRoleList(principal).some((label) => roleSet.has(label) || roleSet.has(toRoleKey(label)));
}

function mergePermissionsForRoles(roleKeys = [], rolePermissionsMap = null) {
  const labels = sortRoleKeysByPrivilege(roleKeys).map(toRoleLabel);
  if (!labels.length) return [];
  const merged = new Set();
  for (const label of labels) {
    for (const permission of mergeRolePermissions(label, [], rolePermissionsMap)) {
      merged.add(permission);
    }
  }
  return [...merged];
}

function isPlatformRoleKey(roleKey) {
  return PLATFORM_ROLE_KEYS.includes(toRoleKey(roleKey));
}

function isForbiddenAssignRoleKey(roleKey) {
  return FORBIDDEN_ASSIGN_ROLE_KEYS.includes(toRoleKey(roleKey));
}

function isKnownRoleKey(roleKey) {
  const key = toRoleKey(roleKey);
  return Boolean(key && ROLE_FROM_DB[key]);
}

function assertNoClientPrivilegeKeys(payload = {}, keys = FORBIDDEN_CREATE_KEYS, errorCode = USER_ROLE_ERROR.CLIENT_IDENTITY_FIELD_FORBIDDEN) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) {
      const code =
        key === "role" || key === "roles" || key === "secondaryRoles"
          ? errorCode
          : USER_ROLE_ERROR.CLIENT_IDENTITY_FIELD_FORBIDDEN;
      throw createUserRoleError(400, `Champ interdit à la création/modification d'identité: ${key}.`, code);
    }
  }
}

function assertSingleRoleOperation(payload = {}) {
  if (payload && typeof payload === "object" && Array.isArray(payload.roles)) {
    throw createUserRoleError(
      400,
      "Le remplacement d'un tableau de rôles est interdit. Utilisez grant ou revoke.",
      USER_ROLE_ERROR.REPLACE_ROLES_FORBIDDEN,
    );
  }
  const role = asTrimmed(payload.role ?? payload.roleKey ?? payload.role_key);
  if (!role) {
    throw createUserRoleError(400, "Rôle obligatoire.", USER_ROLE_ERROR.ROLE_UNKNOWN);
  }
  return role;
}

function formatUserCode(year, sequence) {
  return `USR-${year}-${String(sequence).padStart(5, "0")}`;
}

function extractUserCodeSequence(userCode, year) {
  const match = new RegExp(`^USR-${year}-(\\d+)$`, "i").exec(asTrimmed(userCode));
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function nextUserCodeFromExisting(existingCodes = [], year = new Date().getUTCFullYear()) {
  let max = 0;
  for (const code of existingCodes) {
    const sequence = extractUserCodeSequence(code, year);
    if (sequence != null) max = Math.max(max, sequence);
  }
  return formatUserCode(year, max + 1);
}

function isUserRolesUniqueViolation(error) {
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "").toLowerCase();
  return (
    constraint.includes("user_roles_active") ||
    detail.includes("user_roles") ||
    (detail.includes("user_id") && detail.includes("role_key"))
  );
}

function isUserCodeUniqueViolation(error) {
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "").toLowerCase();
  return constraint === "users_user_code_key" || detail.includes("(user_code)=");
}

module.exports = {
  UNAFFECTED_LABEL,
  USER_ROLE_ERROR,
  FORBIDDEN_CREATE_KEYS,
  FORBIDDEN_IDENTITY_PATCH_KEYS,
  ROLE_PRIVILEGE_ORDER,
  PLATFORM_ROLE_KEYS,
  SCHOOL_PLATFORM_ROLE_KEYS,
  FORBIDDEN_ASSIGN_ROLE_KEYS,
  createUserRoleError,
  toRoleKey,
  toRoleLabel,
  privilegeRank,
  sortRoleKeysByPrivilege,
  sortRoleLabelsByPrivilege,
  primaryRoleKey,
  displayRoles,
  principalRoleList,
  principalHasRole,
  principalHasAnyRole,
  mergePermissionsForRoles,
  isPlatformRoleKey,
  isForbiddenAssignRoleKey,
  isKnownRoleKey,
  assertNoClientPrivilegeKeys,
  assertSingleRoleOperation,
  formatUserCode,
  extractUserCodeSequence,
  nextUserCodeFromExisting,
  isUserRolesUniqueViolation,
  isUserCodeUniqueViolation,
};
