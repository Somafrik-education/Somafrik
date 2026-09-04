"use strict";

const {
  SYSTEM_ROLES_RECONCILIATION_ACTOR,
  listRequiredSystemRoles,
  listCanonicalEstablishmentSeedRoles,
  roleMatchesSpec,
  isRequiredSystemRoleKey,
  canonicalModuleGrantsForPermissions,
  createReconciliationAmbiguityError,
} = require("./canonicalSystemRoles");
const { toRoleKey } = require("./userRoleLifecycle");
const { sanitizePermissionList } = require("./establishmentRolesManagement");
const { createEstablishmentRolesPgStore } = require("../db/establishmentRolesPgStore");
const { createFunctionalRbacPgStore } = require("../db/functionalRbacPgStore");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");

function rolesStore(repo) {
  if (typeof repo.getEstablishmentRolesStore === "function") {
    return repo.getEstablishmentRolesStore();
  }
  if (typeof repo.query === "function") {
    return createEstablishmentRolesPgStore(repo);
  }
  return createEstablishmentRolesMemoryStore();
}

function rbacStoreFor(repo) {
  if (typeof repo.getFunctionalRbacStore === "function") {
    return repo.getFunctionalRbacStore();
  }
  if (typeof repo.query === "function") {
    return createFunctionalRbacPgStore(repo);
  }
  return createFunctionalRbacMemoryStore();
}

function emptyResult() {
  return {
    createdRoles: [],
    skippedArchivedSystem: [],
    skippedCustom: [],
    skippedArchivedCustom: [],
    addedPermissions: [],
    addedDelegations: [],
    addedGrants: [],
  };
}

function findMatches(roles, spec) {
  return (roles || []).filter((role) => roleMatchesSpec(role, spec));
}

function assertNoAmbiguity(roles, specs) {
  for (const spec of specs) {
    const matches = findMatches(roles, spec);
    if (matches.length > 1) {
      throw createReconciliationAmbiguityError(
        `Rôle système ambigu: ${spec.roleName} (${spec.roleKey}) correspond à ${matches.length} lignes.`,
        {
          roleKey: spec.roleKey,
          matches: matches.map((role) => ({
            id: role.id,
            roleName: role.roleName,
            roleCode: role.roleCode,
            status: role.status,
          })),
        },
      );
    }
  }
}

async function addMissingTokens(store, role, tokens, kind, result) {
  const current = new Set(kind === "delegation" ? role.delegationPermissions || [] : role.permissions || []);
  const missing = tokens.filter((token) => !current.has(token));
  if (!missing.length) return;
  if (kind === "delegation") {
    if (typeof store.addMissingDelegationPermissions === "function") {
      await store.addMissingDelegationPermissions(role.id, missing);
    } else {
      await store.updateRole(role.id, {
        delegationPermissions: sanitizePermissionList([...(role.delegationPermissions || []), ...missing]),
      });
    }
    result.addedDelegations.push({ roleKey: toRoleKey(role.roleCode || role.roleName), tokens: missing });
    return;
  }
  if (typeof store.addMissingPermissions === "function") {
    await store.addMissingPermissions(role.id, missing);
  } else {
    await store.updateRole(role.id, {
      permissions: sanitizePermissionList([...(role.permissions || []), ...missing]),
    });
  }
  result.addedPermissions.push({ roleKey: toRoleKey(role.roleCode || role.roleName), tokens: missing });
}

async function reconcileEstablishmentCatalog(store, result) {
  if (!store || typeof store.listRoles !== "function") return;
  const specs = listRequiredSystemRoles({ includePlatform: true });
  const existing = await store.listRoles({ includeArchived: true });
  assertNoAmbiguity(existing, specs);

  const seenIds = new Set();
  for (const spec of specs) {
    const match = findMatches(existing, spec)[0];
    if (!match) {
      const created = await store.insertRole({
        roleCode: spec.roleCode,
        roleName: spec.roleName,
        scope: spec.scope,
        displayOrder: spec.displayOrder,
        schoolAssignable: spec.schoolAssignable,
        permissions: spec.permissions,
        delegationPermissions: spec.permissions,
      });
      result.createdRoles.push({
        roleKey: spec.roleKey,
        roleName: spec.roleName,
        id: created?.id,
      });
      continue;
    }
    seenIds.add(match.id);
    if (match.status === "archived") {
      result.skippedArchivedSystem.push({
        roleKey: spec.roleKey,
        roleName: match.roleName,
        id: match.id,
      });
      await addMissingTokens(store, match, spec.permissions, "permission", result);
      await addMissingTokens(store, match, spec.permissions, "delegation", result);
      continue;
    }
    await addMissingTokens(store, match, spec.permissions, "permission", result);
    await addMissingTokens(store, match, spec.permissions, "delegation", result);
  }

  for (const role of existing) {
    if (seenIds.has(role.id)) continue;
    const key = String(toRoleKey(role.roleCode || role.roleName) || "").toUpperCase();
    if (isRequiredSystemRoleKey(key) && findMatches([role], { roleKey: key, roleName: role.roleName }).length) {
      continue;
    }
    if (role.status === "archived") {
      result.skippedArchivedCustom.push({ roleName: role.roleName, roleCode: role.roleCode, id: role.id });
      continue;
    }
    result.skippedCustom.push({ roleName: role.roleName, roleCode: role.roleCode, id: role.id });
  }
}

async function reconcileFunctionalGrants(store, result) {
  if (!store || typeof store.upsertGrant !== "function") return;
  if (typeof store.seedFunctionalModules === "function") {
    await store.seedFunctionalModules();
  }
  const specs = listRequiredSystemRoles({ includePlatform: true });
  for (const spec of specs) {
    const grants = canonicalModuleGrantsForPermissions(spec.permissions);
    const existing = await store.listGrantsForScope({
      roleKey: spec.roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    const have = new Set(existing.map((row) => row.moduleKey));
    for (const grant of grants) {
      if (have.has(grant.moduleKey)) continue;
      await store.upsertGrant({
        roleKey: spec.roleKey,
        scopeType: "global",
        countryId: null,
        schoolId: null,
        moduleKey: grant.moduleKey,
        canCreate: grant.canCreate,
        canRead: grant.canRead,
        canUpdate: grant.canUpdate,
        canDelete: grant.canDelete,
        updatedBy: SYSTEM_ROLES_RECONCILIATION_ACTOR,
      });
      result.addedGrants.push({ roleKey: spec.roleKey, moduleKey: grant.moduleKey });
    }
  }
}

async function reconcileCanonicalSystemRolesOnRepo(repo, { includeFunctionalGrants = true } = {}) {
  const result = emptyResult();
  const establishmentStore = rolesStore(repo);
  await reconcileEstablishmentCatalog(establishmentStore, result);
  if (includeFunctionalGrants) {
    const functionalStore = rbacStoreFor(repo);
    await reconcileFunctionalGrants(functionalStore, result);
  }
  return result;
}

async function reconcileCanonicalSystemRoles(repo, options = {}) {
  if (typeof repo.withTransaction === "function" && typeof repo.createTxScope === "function") {
    return repo.withTransaction(async (tx) => {
      const scope = repo.createTxScope(tx);
      return reconcileCanonicalSystemRolesOnRepo(scope, options);
    });
  }
  return reconcileCanonicalSystemRolesOnRepo(repo, options);
}

module.exports = {
  reconcileCanonicalSystemRoles,
  reconcileCanonicalSystemRolesOnRepo,
  listCanonicalEstablishmentSeedRoles,
};
