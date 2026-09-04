"use strict";

/**
 * Source de vérité unique des rôles système (catalogue + jetons).
 * Union :
 *   1. alias historiques (rolePermissionsDeclared) — compatibilité routes/JWT ;
 *   2. jetons Domaine:ACTION de securityMatrix (rolePermissions enrichi) ;
 *   3. extras canoniques pour Comptable / Surveillant (absents de la grille).
 *
 * INTERDIT : servir cette carte comme autorité runtime après bootstrap.
 * L'autorité live reste role_module_permissions + establishment_role_permissions.
 */

const seedData = require("../data");
const { ROLE_TO_DB } = require("./clientsManagement");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { sanitizePermissionList } = require("./establishmentRolesManagement");
const { parsePermissionStringsToModuleCrud } = require("./functionalRbacResolution");
const { listFunctionalModules } = require("./functionalModulesCatalog");

const SYSTEM_ROLES_RECONCILIATION_ACTOR = "bootstrap-system-roles-reconciliation-p0";
const SYSTEM_ROLES_RECONCILIATION_ERROR = "SYSTEM_ROLES_RECONCILIATION_AMBIGUOUS";

const REQUIRED_ESTABLISHMENT_SYSTEM_ROLES = Object.freeze([
  Object.freeze({ roleName: "Proviseur", roleKey: "PROVISEUR", schoolAssignable: true, displayOrder: 0 }),
  Object.freeze({ roleName: "Préfet des études", roleKey: "PREFET_ETUDES", schoolAssignable: true, displayOrder: 1 }),
  Object.freeze({ roleName: "Directeur", roleKey: "PRINCIPAL", schoolAssignable: true, displayOrder: 2 }),
  Object.freeze({ roleName: "Secrétaire", roleKey: "SECRETARY", schoolAssignable: true, displayOrder: 3 }),
  Object.freeze({ roleName: "Enseignant", roleKey: "TEACHER", schoolAssignable: true, displayOrder: 4 }),
  Object.freeze({ roleName: "Parent", roleKey: "PARENT", schoolAssignable: false, displayOrder: 5 }),
  Object.freeze({ roleName: "Élève / Étudiant", roleKey: "STUDENT", schoolAssignable: false, displayOrder: 6 }),
  Object.freeze({ roleName: "Comptable", roleKey: "ACCOUNTANT", schoolAssignable: true, displayOrder: 7 }),
  Object.freeze({ roleName: "Surveillant", roleKey: "SUPERVISOR", schoolAssignable: true, displayOrder: 8 }),
]);

const REQUIRED_PLATFORM_SYSTEM_ROLES = Object.freeze([
  Object.freeze({
    roleName: "Super Administrateur Somafrik",
    roleKey: "SUPER_ADMIN",
    schoolAssignable: false,
    scope: "platform",
    displayOrder: -30,
  }),
  Object.freeze({
    roleName: "Admin Pays",
    roleKey: "COUNTRY_ADMIN",
    schoolAssignable: false,
    scope: "country",
    displayOrder: -20,
  }),
  Object.freeze({
    roleName: "Admin School",
    roleKey: "SCHOOL_ADMIN",
    schoolAssignable: false,
    scope: "school",
    displayOrder: -10,
  }),
]);

const PLATFORM_ROLE_KEYS = Object.freeze(new Set(REQUIRED_PLATFORM_SYSTEM_ROLES.map((role) => role.roleKey)));
const REQUIRED_SYSTEM_ROLE_KEYS = Object.freeze(
  new Set([...REQUIRED_ESTABLISHMENT_SYSTEM_ROLES, ...REQUIRED_PLATFORM_SYSTEM_ROLES].map((role) => role.roleKey)),
);

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "fr"),
  );
}

function catalogPermissionsForRoleName(roleName) {
  const declared = seedData.rolePermissionsDeclared?.[roleName] ?? [];
  const enriched = seedData.rolePermissions?.[roleName] ?? [];
  return uniqueSorted([...declared, ...enriched]);
}

function establishmentSafePermissions(roleName) {
  return catalogPermissionsForRoleName(roleName).filter(
    (permission) => permission !== "ALL_PRIVILEGES" && permission !== "COUNTRY_PRIVILEGES",
  );
}

function getCanonicalRolePermissionsMap() {
  const map = {};
  for (const role of [...REQUIRED_ESTABLISHMENT_SYSTEM_ROLES, ...REQUIRED_PLATFORM_SYSTEM_ROLES]) {
    map[role.roleName] = catalogPermissionsForRoleName(role.roleName);
  }
  return map;
}

function listRequiredSystemRoles({ includePlatform = true } = {}) {
  const rows = includePlatform
    ? [...REQUIRED_PLATFORM_SYSTEM_ROLES, ...REQUIRED_ESTABLISHMENT_SYSTEM_ROLES]
    : [...REQUIRED_ESTABLISHMENT_SYSTEM_ROLES];
  return rows.map((role) => ({
    ...role,
    roleCode: ROLE_TO_DB[role.roleName] || role.roleKey,
    scope: role.scope || "school",
    permissions: PLATFORM_ROLE_KEYS.has(role.roleKey)
      ? establishmentSafePermissions(role.roleName)
      : sanitizePermissionList(establishmentSafePermissions(role.roleName)),
  }));
}

function listCanonicalEstablishmentSeedRoles() {
  return listRequiredSystemRoles({ includePlatform: false }).map((role) => ({
    roleName: role.roleName,
    roleCode: role.roleCode,
    roleKey: role.roleKey,
    schoolAssignable: role.schoolAssignable,
    displayOrder: role.displayOrder,
    permissions: role.permissions,
    delegationPermissions: role.permissions,
  }));
}

function isRequiredSystemRoleKey(roleKey) {
  return REQUIRED_SYSTEM_ROLE_KEYS.has(String(toRoleKey(roleKey) || "").toUpperCase());
}

function roleMatchesSpec(role, spec) {
  if (!role || !spec) return false;
  const nameKey = String(toRoleKey(role.roleName || role.role_name) || "").toUpperCase();
  const codeKey = String(toRoleKey(role.roleCode || role.role_code) || "").toUpperCase();
  const roleName = String(role.roleName || role.role_name || "").trim().toLowerCase();
  const specName = String(spec.roleName || toRoleLabel(spec.roleKey) || "").trim().toLowerCase();
  return (
    nameKey === spec.roleKey ||
    codeKey === spec.roleKey ||
    roleName === specName ||
    String(role.roleCode || role.role_code || "").toUpperCase() === spec.roleKey
  );
}

function canonicalModuleGrantsForPermissions(permissions = []) {
  const parsed = parsePermissionStringsToModuleCrud(permissions);
  return listFunctionalModules()
    .map((module) => {
      const crud = parsed[module.moduleKey] || {
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
      };
      return { moduleKey: module.moduleKey, ...crud };
    })
    .filter((grant) => grant.canCreate || grant.canRead || grant.canUpdate || grant.canDelete);
}

function createReconciliationAmbiguityError(message, details) {
  const error = new Error(message);
  error.code = SYSTEM_ROLES_RECONCILIATION_ERROR;
  error.statusCode = 409;
  if (details) error.details = details;
  return error;
}

module.exports = {
  SYSTEM_ROLES_RECONCILIATION_ACTOR,
  SYSTEM_ROLES_RECONCILIATION_ERROR,
  REQUIRED_ESTABLISHMENT_SYSTEM_ROLES,
  REQUIRED_PLATFORM_SYSTEM_ROLES,
  REQUIRED_SYSTEM_ROLE_KEYS,
  PLATFORM_ROLE_KEYS,
  getCanonicalRolePermissionsMap,
  listRequiredSystemRoles,
  listCanonicalEstablishmentSeedRoles,
  isRequiredSystemRoleKey,
  roleMatchesSpec,
  canonicalModuleGrantsForPermissions,
  catalogPermissionsForRoleName,
  establishmentSafePermissions,
  createReconciliationAmbiguityError,
};
