"use strict";

/**
 * Résolution fail-closed des permissions CRUD.
 *
 * Ordre de portée (premier match gagne, pas de fusion des flags entre portées) :
 *   1. permission spécifique établissement (scope_type=school, school_id)
 *   2. permission pays (scope_type=country, country_id)
 *   3. permission globale par rôle (scope_type=global)
 *   4. DENY (tous les flags false)
 *
 * Multi-rôle : UNION (OR) des flags des rôles actifs user_roles dans le scope.
 * Un rôle révoqué / absent de user_roles ne contribue pas.
 * SUPER_ADMIN : invariants forcés (jamais de lock-out plateforme).
 */

const { toRoleKey, toRoleLabel, sortRoleKeysByPrivilege } = require("./userRoleLifecycle");
const { listFunctionalModules, getModuleByKey, getModuleByName } = require("./functionalModulesCatalog");
const {
  PROTECTED_SYSTEM_ROLE_KEYS,
  SUPER_ADMIN_INVARIANT_MODULES,
} = require("./functionalRbacManagement");

function emptyCrud() {
  return { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
}

function orCrud(left, right) {
  return {
    canCreate: Boolean(left.canCreate || right.canCreate),
    canRead: Boolean(left.canRead || right.canRead),
    canUpdate: Boolean(left.canUpdate || right.canUpdate),
    canDelete: Boolean(left.canDelete || right.canDelete),
  };
}

function crudFromRow(row) {
  if (!row) return null;
  return {
    canCreate: Boolean(row.canCreate ?? row.can_create),
    canRead: Boolean(row.canRead ?? row.can_read),
    canUpdate: Boolean(row.canUpdate ?? row.can_update),
    canDelete: Boolean(row.canDelete ?? row.can_delete),
  };
}

function grantKey(roleKey, scopeType, countryId, schoolId, moduleKey) {
  return [
    String(roleKey || "").toUpperCase(),
    scopeType,
    countryId || "",
    schoolId || "",
    moduleKey,
  ].join("|");
}

function indexGrants(grants = []) {
  const map = new Map();
  for (const grant of grants) {
    if ((grant.status || "active") !== "active") continue;
    const roleKey = String(grant.roleKey || grant.role_key || "").toUpperCase();
    const scopeType = grant.scopeType || grant.scope_type;
    const countryId = grant.countryId || grant.country_id || "";
    const schoolId = grant.schoolId || grant.school_id || "";
    const moduleKey = grant.moduleKey || grant.module_key;
    if (!roleKey || !scopeType || !moduleKey) continue;
    map.set(grantKey(roleKey, scopeType, countryId, schoolId, moduleKey), grant);
  }
  return map;
}

function grantTimestamp(grant) {
  const raw = grant?.updatedAt || grant?.updated_at || grant?.createdAt || grant?.created_at || 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function pickNewerGrant(current, candidate) {
  if (!current) return candidate;
  return grantTimestamp(candidate) >= grantTimestamp(current) ? candidate : current;
}

function pickGrant(index, roleKey, moduleKey, { schoolId, countryId }) {
  const normalizedRole = String(roleKey || "").toUpperCase();
  const schoolIdStr = schoolId == null || schoolId === "" ? "" : String(schoolId);
  const countryIdStr = countryId == null || countryId === "" ? "" : String(countryId);

  if (schoolIdStr) {
    let schoolGrant = null;
    for (const grant of index.values()) {
      const grantRole = String(grant.roleKey || grant.role_key || "").toUpperCase();
      const grantScope = grant.scopeType || grant.scope_type;
      const grantSchool = String(grant.schoolId || grant.school_id || "");
      const grantModule = grant.moduleKey || grant.module_key;
      if (
        grantRole === normalizedRole &&
        grantScope === "school" &&
        grantSchool === schoolIdStr &&
        grantModule === moduleKey
      ) {
        schoolGrant = pickNewerGrant(schoolGrant, grant);
      }
    }
    if (schoolGrant) return schoolGrant;
  }
  if (countryIdStr) {
    let countryGrant = null;
    for (const grant of index.values()) {
      const grantRole = String(grant.roleKey || grant.role_key || "").toUpperCase();
      const grantScope = grant.scopeType || grant.scope_type;
      const grantCountry = String(grant.countryId || grant.country_id || "");
      const grantSchool = grant.schoolId || grant.school_id;
      const grantModule = grant.moduleKey || grant.module_key;
      if (
        grantRole === normalizedRole &&
        grantScope === "country" &&
        grantCountry === countryIdStr &&
        !grantSchool &&
        grantModule === moduleKey
      ) {
        countryGrant = pickNewerGrant(countryGrant, grant);
      }
    }
    if (countryGrant) return countryGrant;
  }
  return index.get(grantKey(normalizedRole, "global", "", "", moduleKey)) || null;
}

function applySuperAdminInvariants(roleKeys, modulesCrud) {
  const keys = new Set((roleKeys || []).map((key) => String(key).toUpperCase()));
  if (!keys.has("SUPER_ADMIN")) return modulesCrud;
  const next = { ...modulesCrud };
  for (const [moduleKey, flags] of Object.entries(SUPER_ADMIN_INVARIANT_MODULES)) {
    next[moduleKey] = orCrud(next[moduleKey] || emptyCrud(), flags);
  }
  return next;
}

function flattenModulesToTokens(modulesCrud) {
  const tokens = [];
  for (const module of listFunctionalModules()) {
    const crud = modulesCrud[module.moduleKey] || emptyCrud();
    if (crud.canCreate) tokens.push(`${module.moduleName}:CREATE`);
    if (crud.canRead) tokens.push(`${module.moduleName}:READ`);
    if (crud.canUpdate) tokens.push(`${module.moduleName}:UPDATE`);
    if (crud.canDelete) tokens.push(`${module.moduleName}:DELETE`);
  }
  return tokens;
}

function resolveModulesCrudForRoles(roleKeys, grants, scope = {}) {
  const index = indexGrants(grants);
  const keys = sortRoleKeysByPrivilege(roleKeys || []);
  const modulesCrud = {};
  for (const module of listFunctionalModules()) {
    let crud = emptyCrud();
    for (const roleKey of keys) {
      const grant = pickGrant(index, roleKey, module.moduleKey, scope);
      const fromGrant = crudFromRow(grant);
      if (fromGrant) crud = orCrud(crud, fromGrant);
    }
    modulesCrud[module.moduleKey] = crud;
  }
  return applySuperAdminInvariants(keys, modulesCrud);
}

function resolveEffectivePermissionSet(roleKeys, grants, scope = {}) {
  const keys = sortRoleKeysByPrivilege(roleKeys || []);
  const modulesCrud = resolveModulesCrudForRoles(keys, grants, scope);
  const permissions = flattenModulesToTokens(modulesCrud);
  if (keys.includes("SUPER_ADMIN")) {
    if (!permissions.includes("ALL_PRIVILEGES")) permissions.push("ALL_PRIVILEGES");
  }
  if (keys.includes("COUNTRY_ADMIN")) {
    if (!permissions.includes("COUNTRY_PRIVILEGES")) permissions.push("COUNTRY_PRIVILEGES");
    const filtered = permissions.filter((token) => token !== "Pays:CREATE" && token !== "Pays:DELETE");
    return {
      roleKeys: keys,
      modules: modulesCrud,
      permissions: filtered,
    };
  }
  return { roleKeys: keys, modules: modulesCrud, permissions };
}

function moduleMatchesNormalized(module, normalized) {
  const moduleNorm = module.moduleName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes(moduleNorm)) return true;
  if (module.moduleKey === "students" && normalized.includes("enfant")) return true;
  if (module.moduleKey === "attendance" && normalized.includes("appel")) return true;
  return false;
}

function parsePermissionStringsToModuleCrud(permissions = []) {
  const modulesCrud = {};
  for (const module of listFunctionalModules()) modulesCrud[module.moduleKey] = emptyCrud();
  for (const raw of permissions) {
    const token = String(raw ?? "").trim();
    if (!token || token === "ALL_PRIVILEGES" || token === "COUNTRY_PRIVILEGES") continue;
    const match = /^(.+):(CREATE|READ|UPDATE|DELETE)$/.exec(token);
    if (match) {
      const module = getModuleByName(match[1]);
      if (!module) continue;
      const action = match[2];
      if (action === "CREATE") modulesCrud[module.moduleKey].canCreate = true;
      if (action === "READ") modulesCrud[module.moduleKey].canRead = true;
      if (action === "UPDATE") modulesCrud[module.moduleKey].canUpdate = true;
      if (action === "DELETE") modulesCrud[module.moduleKey].canDelete = true;
      continue;
    }
    const normalized = token
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    for (const module of listFunctionalModules()) {
      if (!moduleMatchesNormalized(module, normalized)) continue;
      if (normalized.startsWith("voir ") || normalized.startsWith("lire ")) {
        modulesCrud[module.moduleKey].canRead = true;
      }
      if (normalized.startsWith("ajouter ") || normalized.startsWith("creer ")) {
        modulesCrud[module.moduleKey].canCreate = true;
      }
      if (normalized.startsWith("modifier ") || normalized.startsWith("faire ")) {
        modulesCrud[module.moduleKey].canUpdate = true;
        if (normalized.startsWith("faire ")) modulesCrud[module.moduleKey].canRead = true;
      }
      if (normalized.startsWith("gerer ") || normalized.includes("crud")) {
        modulesCrud[module.moduleKey] = {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        };
      }
    }
  }
  return modulesCrud;
}

function isProtectedSystemRoleKey(roleKey) {
  return PROTECTED_SYSTEM_ROLE_KEYS.has(String(toRoleKey(roleKey) || "").toUpperCase());
}

function permissionToken(moduleKey, action) {
  const module = getModuleByKey(moduleKey);
  if (!module) return "";
  return `${module.moduleName}:${action}`;
}

module.exports = {
  emptyCrud,
  orCrud,
  crudFromRow,
  pickGrant,
  indexGrants,
  applySuperAdminInvariants,
  flattenModulesToTokens,
  resolveModulesCrudForRoles,
  resolveEffectivePermissionSet,
  parsePermissionStringsToModuleCrud,
  isProtectedSystemRoleKey,
  permissionToken,
  toRoleLabel,
};
