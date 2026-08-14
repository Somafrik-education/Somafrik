"use strict";

const { getCountryCodeFromScope } = require("./countryScope");

const ESTABLISHMENT_ROLES_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  ROLE_ARCHIVED: "ROLE_ARCHIVED",
  ROLE_NOT_ASSIGNABLE: "ROLE_NOT_ASSIGNABLE",
  PERMISSION_FORBIDDEN: "PERMISSION_FORBIDDEN",
  PRIVILEGE_ESCALATION: "PRIVILEGE_ESCALATION",
  LEGACY_USER_ROLES_WRITE_FORBIDDEN: "LEGACY_USER_ROLES_WRITE_FORBIDDEN",
  LEGACY_ESTABLISHMENT_ROLES_AMBIGUOUS: "LEGACY_ESTABLISHMENT_ROLES_AMBIGUOUS",
});

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);
const PLATFORM_ROLE_NAMES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK", "Admin Pays", "Admin School"]);
const FORBIDDEN_PERMISSIONS = new Set(["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeRoleCode(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createEstablishmentRolesError(status, message, code, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code || ESTABLISHMENT_ROLES_ERROR.FORBIDDEN;
  if (details) error.details = details;
  return error;
}

function isSuperAdminPrincipal(principal) {
  return SUPER_ADMIN_ROLES.has(asTrimmed(principal?.role));
}

function isSchoolAdminPrincipal(principal) {
  return asTrimmed(principal?.role) === "Admin School";
}

function ignoreClientScope(payload = {}) {
  const next = { ...(payload && typeof payload === "object" ? payload : {}) };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.countryCode;
  delete next.country;
  return next;
}

function establishmentRolesAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

function assertSuperAdmin(principal) {
  if (!isSuperAdminPrincipal(principal)) {
    throw createEstablishmentRolesError(
      403,
      "Seul le Super Administrateur peut gérer le catalogue des rôles.",
      ESTABLISHMENT_ROLES_ERROR.FORBIDDEN,
    );
  }
}

function assertSchoolRoleAssignmentRead(principal) {
  if (isSuperAdminPrincipal(principal) || isSchoolAdminPrincipal(principal)) return;
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  const allowed = [
    "Paramètres Établissement:READ",
    "Paramètres Établissement:UPDATE",
    "Utilisateurs:READ",
    "Utilisateurs:UPDATE",
    "Gérer utilisateurs",
    "ALL_PRIVILEGES",
  ];
  if (!allowed.some((key) => permissions.includes(key))) {
    throw createEstablishmentRolesError(403, "Accès refusé au catalogue des rôles.", ESTABLISHMENT_ROLES_ERROR.FORBIDDEN);
  }
}

function assertSchoolRoleAssignmentWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  const allowed = [
    "Paramètres Établissement:UPDATE",
    "Utilisateurs:UPDATE",
    "Gérer utilisateurs",
    "ALL_PRIVILEGES",
  ];
  if (!allowed.some((key) => permissions.includes(key))) {
    throw createEstablishmentRolesError(
      403,
      "Vous n'avez pas le droit d'affecter des rôles à cet établissement.",
      ESTABLISHMENT_ROLES_ERROR.FORBIDDEN,
    );
  }
}

function sanitizePermissionList(permissions = []) {
  const unique = new Set();
  for (const permission of permissions) {
    const value = asTrimmed(permission);
    if (!value) continue;
    if (FORBIDDEN_PERMISSIONS.has(value)) {
      throw createEstablishmentRolesError(
        403,
        `Permission interdite: ${value}`,
        ESTABLISHMENT_ROLES_ERROR.PERMISSION_FORBIDDEN,
      );
    }
    unique.add(value);
  }
  return [...unique].sort((left, right) => left.localeCompare(right, "fr"));
}

function assertPermissionsWithinDelegation(assignerPermissions = [], requestedPermissions = []) {
  const allowed = new Set(assignerPermissions);
  for (const permission of requestedPermissions) {
    if (!allowed.has(permission)) {
      throw createEstablishmentRolesError(
        403,
        "Élévation de privilèges interdite.",
        ESTABLISHMENT_ROLES_ERROR.PRIVILEGE_ESCALATION,
        { permission },
      );
    }
  }
}

function mapRoleRow(row) {
  return {
    id: row.id,
    roleCode: row.role_code,
    roleName: row.role_name,
    scope: row.scope,
    displayOrder: Number(row.display_order ?? 0),
    status: row.status === "archived" ? "archived" : "active",
    schoolAssignable: Boolean(row.school_assignable),
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    delegationPermissions: Array.isArray(row.delegation_permissions) ? row.delegation_permissions : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasLegacyUserRolesKey(payload) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "userRoles");
}

function assertNoLegacyUserRolesWrite(payload) {
  if (!payload || typeof payload !== "object") return;
  if (hasLegacyUserRolesKey(payload)) {
    throw createEstablishmentRolesError(
      400,
      "La clé userRoles n'est plus modifiable via academic-config. Utilisez le catalogue canonique des rôles.",
      ESTABLISHMENT_ROLES_ERROR.LEGACY_USER_ROLES_WRITE_FORBIDDEN,
    );
  }
}

function stripLegacyUserRoles(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  delete next.userRoles;
  return next;
}

function resolvePrincipalCountryCode(principal) {
  return asTrimmed(principal?.countryCode) || getCountryCodeFromScope(principal?.countryScope);
}

function isPlatformRoleName(roleName) {
  return PLATFORM_ROLE_NAMES.has(asTrimmed(roleName));
}

module.exports = {
  ESTABLISHMENT_ROLES_ERROR,
  SUPER_ADMIN_ROLES,
  PLATFORM_ROLE_NAMES,
  FORBIDDEN_PERMISSIONS,
  asTrimmed,
  normalizeRoleCode,
  createEstablishmentRolesError,
  isSuperAdminPrincipal,
  isSchoolAdminPrincipal,
  ignoreClientScope,
  establishmentRolesAuditMetaFromRequest,
  assertSuperAdmin,
  assertSchoolRoleAssignmentRead,
  assertSchoolRoleAssignmentWrite,
  sanitizePermissionList,
  assertPermissionsWithinDelegation,
  mapRoleRow,
  hasLegacyUserRolesKey,
  assertNoLegacyUserRolesWrite,
  stripLegacyUserRoles,
  resolvePrincipalCountryCode,
  isPlatformRoleName,
};
