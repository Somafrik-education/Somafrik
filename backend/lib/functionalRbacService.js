"use strict";

const { listFunctionalModules, getModuleByKey, isKnownModuleKey } = require("./functionalModulesCatalog");
const {
  FUNCTIONAL_RBAC_ERROR,
  createFunctionalRbacError,
  throwLegacyRolePermissionsWrite,
  normalizeScope,
  assertNotProtectedArchive,
  timestampsEqual,
  looksLikeUuid,
  PROTECTED_SYSTEM_ROLE_KEYS,
} = require("./functionalRbacManagement");
const {
  resolveEffectivePermissionSet,
  parsePermissionStringsToModuleCrud,
  emptyCrud,
} = require("./functionalRbacResolution");
const { assertSuperAdmin, asTrimmed, normalizeRoleCode } = require("./establishmentRolesManagement");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const {
  enrichCatalogModules,
  mandatoryByRoleDto,
  moduleContractDto,
  overlayMandatoryFlags,
  assertMandatoryPermissionPatch,
} = require("./rbacMandatoryPermissions");
const { createFunctionalRbacPgStore } = require("../db/functionalRbacPgStore");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { reconcileCanonicalPlanningGrants } = require("./planningRbacCanonical");
const { reconcileCanonicalRoomsReplacementsGrants } = require("./planningRoomsReplacementsRbac");

function rbacStore(repo) {
  if (typeof repo.getFunctionalRbacStore === "function") {
    return repo.getFunctionalRbacStore();
  }
  if (typeof repo.query === "function") {
    return createFunctionalRbacPgStore(repo);
  }
  return createFunctionalRbacMemoryStore();
}

async function writeRbacAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordAudit !== "function") {
    throw createFunctionalRbacError(500, "Audit indisponible dans la transaction.", FUNCTIONAL_RBAC_ERROR.FORBIDDEN);
  }
  await tx.recordAudit(
    {
      schoolCode: entry.schoolCode || principal?.schoolCode,
      userId: principal?.sub || principal?.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId ?? ""),
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    },
    tx,
  );
}

function actorId(principal) {
  return asTrimmed(principal?.identifier || principal?.sub || principal?.id) || null;
}

function functionalRbacAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

async function ensureFunctionalRbacBootstrap(repo) {
  const store = rbacStore(repo);
  await store.seedFunctionalModules();
  await ensurePlatformRolesInCatalog(repo);
  if (typeof store.markSystemProtected === "function") {
    await store.markSystemProtected([...PROTECTED_SYSTEM_ROLE_KEYS]);
  }
  await backfillGlobalGrantsFromLegacyMaps(repo, store);
  await backfillMissingGlobalModuleGrants(repo, store);
  // Planning de cours : UNION canonique même si le rôle (Préfet / Enseignant)
  // existait déjà avec d'autres grants. backfillMissing* ne complète un module
  // que depuis le catalogue établissement, souvent périmé après le 1er bootstrap.
  await reconcileCanonicalPlanningGrants(store);
  await reconcileCanonicalRoomsReplacementsGrants(store);
}

async function ensurePlatformRolesInCatalog(repo) {
  if (typeof repo.getEstablishmentRolesStore !== "function") return;
  const rolesStore = repo.getEstablishmentRolesStore();
  const platform = [
    { roleCode: "SUPER_ADMIN", roleName: "Super Administrateur Somafrik", scope: "platform", schoolAssignable: false },
    { roleCode: "COUNTRY_ADMIN", roleName: "Admin Pays", scope: "country", schoolAssignable: false },
    { roleCode: "SCHOOL_ADMIN", roleName: "Admin School", scope: "school", schoolAssignable: false },
  ];
  for (const role of platform) {
    const existing = await rolesStore.getRoleByNameOrCode(role.roleCode);
    if (existing) continue;
    try {
      await rolesStore.insertRole({
        ...role,
        displayOrder: -10,
        permissions: [],
        delegationPermissions: [],
      });
    } catch (error) {
      if (error?.code !== "23505") throw error;
    }
  }
}

function permissionList(value) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

/**
 * Fusion fail-closed des cartes métier : une liste vide n'écrase jamais une liste
 * déjà peuplée (le catalogue plateforme SUPER_ADMIN/SCHOOL_ADMIN est inséré sans
 * jetons, ce qui ne doit pas effacer data.js / role_permissions JSONB).
 */
function mergeRolePermissionMaps(...maps) {
  const merged = {};
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const [roleName, permissions] of Object.entries(map)) {
      const list = permissionList(permissions);
      const existing = merged[roleName];
      if (!existing) {
        merged[roleName] = [...list];
        continue;
      }
      if (!list.length) continue;
      merged[roleName] = [...new Set([...existing, ...list])];
    }
  }
  return merged;
}

async function loadLegacyRolePermissionMaps(repo) {
  let seedMap = {};
  try {
    const seedData = require("../data");
    seedMap =
      (typeof seedData.rolePermissionsForLiveRbac === "function"
        ? seedData.rolePermissionsForLiveRbac()
        : seedData.rolePermissionsDeclared) ??
      seedData.rolePermissions ??
      {};
  } catch {
    seedMap = {};
  }
  const platformMap =
    (typeof repo.getPlatformRolePermissionsMap === "function"
      ? await repo.getPlatformRolePermissionsMap()
      : null) ??
    (typeof repo.getPlatformStore === "function"
      ? await repo.getPlatformStore().getRolePermissionsMap?.()
      : null) ??
    {};
  let establishmentMap = {};
  try {
    establishmentMap = (await repo.getEstablishmentRolesStore?.().getPermissionsMap?.()) ?? {};
  } catch {
    establishmentMap = {};
  }
  return mergeLiveRbacMaps(seedMap, platformMap, establishmentMap);
}

/**
 * Fusion live : les rôles plateforme gardent « liste vide n'écrase pas ».
 * Un rôle établissement présent au catalogue avec [] est un DENY explicite.
 */
function mergeLiveRbacMaps(seedMap, platformMap, establishmentMap) {
  const merged = mergeRolePermissionMaps(seedMap, platformMap);
  for (const [roleName, permissions] of Object.entries(establishmentMap || {})) {
    const roleKey = toRoleKey(roleName);
    const list = permissionList(permissions);
    if (PROTECTED_SYSTEM_ROLE_KEYS.has(roleKey)) {
      if (!list.length) continue;
      const existing = merged[roleName] || [];
      merged[roleName] = [...new Set([...existing, ...list])];
      continue;
    }
    merged[roleName] = [...list];
  }
  return merged;
}

function catalogPermissionList(establishmentMap, roleKey) {
  if (!establishmentMap || typeof establishmentMap !== "object") return undefined;
  const key = String(roleKey || "").toUpperCase();
  const label = toRoleLabel(key);
  const code = normalizeRoleCode(label || key);
  const candidates = [label, roleKey, key, code].filter(Boolean);
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(establishmentMap, candidate)) {
      return establishmentMap[candidate];
    }
  }
  return undefined;
}

function applyEstablishmentCatalogFailClosed(roleKeys, establishmentMap) {
  return (roleKeys || []).filter((roleKey) => {
    const normalized = String(roleKey || "").toUpperCase();
    if (PROTECTED_SYSTEM_ROLE_KEYS.has(normalized)) return true;
    const catalog = catalogPermissionList(establishmentMap, normalized);
    if (catalog === undefined) return true;
    return permissionList(catalog).length > 0;
  });
}

async function backfillGlobalGrantsFromLegacyMaps(repo, store) {
  const count = await store.countActiveGrants();
  if (count > 0) return false;
  const merged = await loadLegacyRolePermissionMaps(repo);
  for (const [roleName, permissions] of Object.entries(merged)) {
    const roleKey = toRoleKey(roleName);
    if (!roleKey) continue;
    const modulesCrud = parsePermissionStringsToModuleCrud(permissions);
    for (const module of listFunctionalModules()) {
      const crud = modulesCrud[module.moduleKey] || emptyCrud();
      if (!crud.canCreate && !crud.canRead && !crud.canUpdate && !crud.canDelete) continue;
      await store.upsertGrant({
        roleKey,
        scopeType: "global",
        countryId: null,
        schoolId: null,
        moduleKey: module.moduleKey,
        ...crud,
        updatedBy: "bootstrap",
      });
    }
  }
  return true;
}

/**
 * Complète les modules absents d'une matrice déjà peuplée (ex. Affectations
 * ajouté au catalogue après le backfill initial #221). N'écrase jamais un
 * grant déjà présent, y compris un DENY explicite (tous flags false).
 */
async function backfillMissingGlobalModuleGrants(repo, store) {
  const merged = await loadLegacyRolePermissionMaps(repo);
  let inserted = 0;
  for (const [roleName, permissions] of Object.entries(merged)) {
    const roleKey = toRoleKey(roleName);
    if (!roleKey) continue;
    const existing = await store.listGrantsForScope({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    const have = new Set(existing.map((row) => row.moduleKey));
    const modulesCrud = parsePermissionStringsToModuleCrud(permissions);
    for (const module of listFunctionalModules()) {
      if (have.has(module.moduleKey)) continue;
      const crud = modulesCrud[module.moduleKey] || emptyCrud();
      if (!crud.canCreate && !crud.canRead && !crud.canUpdate && !crud.canDelete) continue;
      await store.upsertGrant({
        roleKey,
        scopeType: "global",
        countryId: null,
        schoolId: null,
        moduleKey: module.moduleKey,
        ...crud,
        updatedBy: "bootstrap-missing-modules",
      });
      inserted += 1;
    }
  }
  return inserted;
}

async function resolveScopeIds(store, payload) {
  const requested = normalizeScope(payload);
  if (requested.scopeType === "global") {
    return { ...requested, country: null, school: null, countryCode: null, schoolCode: null };
  }
  const resolved = await store.resolveCountryAndSchool({
    countryCode: payload.countryCode || (!looksLikeUuid(payload.countryId) ? payload.countryId : undefined),
    schoolCode: payload.schoolCode || (!looksLikeUuid(payload.schoolId) ? payload.schoolCode || requested.schoolId : payload.schoolCode),
    countryId: looksLikeUuid(payload.countryId)
      ? payload.countryId
      : looksLikeUuid(requested.countryId)
        ? requested.countryId
        : undefined,
    schoolId: looksLikeUuid(payload.schoolId)
      ? payload.schoolId
      : looksLikeUuid(requested.schoolId)
        ? requested.schoolId
        : undefined,
  });
  if (requested.scopeType === "school") {
    if (!resolved.school) {
      throw createFunctionalRbacError(400, "Établissement introuvable.", FUNCTIONAL_RBAC_ERROR.INVALID_SCOPE);
    }
    return {
      scopeType: "school",
      countryId: resolved.school.country_id || resolved.country?.id || null,
      schoolId: resolved.school.id,
      country: resolved.country,
      school: resolved.school,
      countryCode: resolved.country?.code || resolved.school.country_code || null,
      schoolCode: resolved.school.school_code,
    };
  }
  if (!resolved.country) {
    throw createFunctionalRbacError(400, "Pays introuvable.", FUNCTIONAL_RBAC_ERROR.INVALID_SCOPE);
  }
  return {
    scopeType: "country",
    countryId: resolved.country.id,
    schoolId: null,
    country: resolved.country,
    school: null,
    countryCode: resolved.country.code,
    schoolCode: null,
  };
}

async function listRbacCatalog(repo, principal) {
  assertSuperAdmin(principal);
  const store = rbacStore(repo);
  const [modules, usageRoles] = await Promise.all([
    store.listModules(),
    store.listRolesWithUsage({ includeArchived: true }).catch(() => []),
  ]);
  let roles = Array.isArray(usageRoles) ? usageRoles : [];
  if (!roles.length && typeof repo.listEstablishmentRoles === "function") {
    const listed = await repo.listEstablishmentRoles({ includeArchived: true });
    roles = listed || [];
  }
  roles = roles.map((row) => ({
    ...row,
    activeUserCount: Number(row.activeUserCount ?? 0),
    systemProtected:
      Boolean(row.systemProtected) ||
      PROTECTED_SYSTEM_ROLE_KEYS.has(String(row.roleCode || "").toUpperCase()),
  }));
  return {
    modules: enrichCatalogModules(modules),
    roles,
    protectedRoleKeys: [...PROTECTED_SYSTEM_ROLE_KEYS],
    mandatoryByRole: mandatoryByRoleDto(),
    invariants: {
      SUPER_ADMIN: Object.keys(require("./functionalRbacManagement").SUPER_ADMIN_INVARIANT_MODULES),
    },
  };
}

async function getConfiguredPermissions(repo, query, principal) {
  assertSuperAdmin(principal);
  const store = rbacStore(repo);
  const roleKey = toRoleKey(query.roleKey || query.role);
  if (!roleKey) {
    throw createFunctionalRbacError(400, "role_key obligatoire.", FUNCTIONAL_RBAC_ERROR.INVALID_ROLE);
  }
  const scope = await resolveScopeIds(store, query);
  const grants = await store.listGrantsForScope({
    roleKey,
    scopeType: scope.scopeType,
    countryId: scope.countryId,
    schoolId: scope.schoolId,
  });
  const updatedAt = await store.maxUpdatedAtForScope({
    roleKey,
    scopeType: scope.scopeType,
    countryId: scope.countryId,
    schoolId: scope.schoolId,
  });
  const byModule = Object.fromEntries(grants.map((grant) => [grant.moduleKey, grant]));
  const modules = listFunctionalModules().map((module) => {
    const grant = byModule[module.moduleKey];
    const flags = overlayMandatoryFlags(roleKey, module.moduleKey, {
      canCreate: Boolean(grant?.canCreate),
      canRead: Boolean(grant?.canRead),
      canUpdate: Boolean(grant?.canUpdate),
      canDelete: Boolean(grant?.canDelete),
    });
    return {
      moduleKey: module.moduleKey,
      moduleName: module.moduleName,
      appliesWeb: module.appliesWeb,
      appliesMobile: module.appliesMobile,
      ...flags,
      configured: Boolean(grant),
      ...moduleContractDto(roleKey, module.moduleKey, flags),
    };
  });
  return {
    roleKey,
    roleName: toRoleLabel(roleKey),
    scopeType: scope.scopeType,
    countryId: scope.countryId,
    schoolId: scope.schoolId,
    countryCode: scope.countryCode,
    schoolCode: scope.schoolCode,
    updatedAt,
    modules,
  };
}

async function getEffectivePermissionsConfigured(repo, query, principal) {
  assertSuperAdmin(principal);
  const store = rbacStore(repo);
  const roleKey = toRoleKey(query.roleKey || query.role);
  if (!roleKey) {
    throw createFunctionalRbacError(400, "role_key obligatoire.", FUNCTIONAL_RBAC_ERROR.INVALID_ROLE);
  }
  const scope = await resolveScopeIds(store, query);
  const grants = await store.listGrantsForRoles([roleKey]);
  const resolved = resolveEffectivePermissionSet([roleKey], grants, {
    schoolId: scope.schoolId,
    countryId: scope.countryId,
  });
  return {
    roleKey,
    roleName: toRoleLabel(roleKey),
    scopeType: scope.scopeType,
    countryCode: scope.countryCode,
    schoolCode: scope.schoolCode,
    modules: listFunctionalModules().map((module) => ({
      moduleKey: module.moduleKey,
      moduleName: module.moduleName,
      ...(resolved.modules[module.moduleKey] || emptyCrud()),
    })),
    permissions: resolved.permissions,
  };
}

function sanitizeGrantPatch(rawGrant) {
  const moduleKey = asTrimmed(rawGrant.moduleKey || rawGrant.module_key);
  if (!isKnownModuleKey(moduleKey)) {
    throw createFunctionalRbacError(400, `module_key inconnu: ${moduleKey}`, FUNCTIONAL_RBAC_ERROR.INVALID_MODULE);
  }
  return {
    moduleKey,
    canCreate: Boolean(rawGrant.canCreate ?? rawGrant.can_create),
    canRead: Boolean(rawGrant.canRead ?? rawGrant.can_read),
    canUpdate: Boolean(rawGrant.canUpdate ?? rawGrant.can_update),
    canDelete: Boolean(rawGrant.canDelete ?? rawGrant.can_delete),
  };
}

function diffGrant(before, after) {
  const events = [];
  for (const action of ["canCreate", "canRead", "canUpdate", "canDelete"]) {
    const was = Boolean(before?.[action]);
    const next = Boolean(after[action]);
    if (was === next) continue;
    events.push({
      action: next ? "ROLE_PERMISSION_GRANTED" : "ROLE_PERMISSION_REVOKED",
      field: action,
      moduleKey: after.moduleKey,
    });
  }
  return events;
}

async function patchConfiguredPermissions(repo, rawPayload, principal, auditMeta) {
  assertSuperAdmin(principal);
  const payload = rawPayload ?? {};
  const roleKey = toRoleKey(payload.roleKey || payload.role);
  if (!roleKey) {
    throw createFunctionalRbacError(400, "role_key obligatoire.", FUNCTIONAL_RBAC_ERROR.INVALID_ROLE);
  }
  const grants = Array.isArray(payload.grants) ? payload.grants.map(sanitizeGrantPatch) : [];
  if (!grants.length) {
    throw createFunctionalRbacError(400, "grants (delta) obligatoire.", FUNCTIONAL_RBAC_ERROR.INVALID_MODULE);
  }
  assertMandatoryPermissionPatch(roleKey, grants);
  const store = rbacStore(repo);

  return repo.withTransaction(async (tx) => {
    const scopeRepo = repo.createTxScope(tx);
    const scopedStore = rbacStore(scopeRepo);
    const scope = await resolveScopeIds(scopedStore, payload);
    const currentUpdatedAt = await scopedStore.maxUpdatedAtForScope({
      roleKey,
      scopeType: scope.scopeType,
      countryId: scope.countryId,
      schoolId: scope.schoolId,
    });
    const expected = payload.expectedUpdatedAt;
    if (currentUpdatedAt && expected && !timestampsEqual(currentUpdatedAt, expected)) {
      throw createFunctionalRbacError(
        409,
        "Conflit de concurrence : la matrice a été modifiée. Rechargez avant d'enregistrer.",
        FUNCTIONAL_RBAC_ERROR.CONFLICT,
        { expectedUpdatedAt: expected, actualUpdatedAt: currentUpdatedAt },
      );
    }
    if (currentUpdatedAt && !expected) {
      throw createFunctionalRbacError(
        409,
        "expectedUpdatedAt obligatoire pour éviter un last-write-wins.",
        FUNCTIONAL_RBAC_ERROR.CONFLICT,
        { actualUpdatedAt: currentUpdatedAt },
      );
    }

    const beforeRows = await scopedStore.listGrantsForScope({
      roleKey,
      scopeType: scope.scopeType,
      countryId: scope.countryId,
      schoolId: scope.schoolId,
    });
    const beforeByModule = Object.fromEntries(beforeRows.map((row) => [row.moduleKey, row]));
    const saved = [];
    const auditEvents = [];
    for (const grant of grants) {
      const before = beforeByModule[grant.moduleKey] || emptyCrud();
      const after = await scopedStore.upsertGrant({
        roleKey,
        scopeType: scope.scopeType,
        countryId: scope.countryId,
        schoolId: scope.schoolId,
        ...grant,
        updatedBy: actorId(principal),
      });
      saved.push(after);
      for (const event of diffGrant(before, grant)) {
        auditEvents.push(event);
      }
    }

    await writeRbacAudit(scopeRepo, principal, auditMeta, {
      action: "ROLE_PERMISSION_MATRIX_UPDATED",
      entityType: "role_module_permissions",
      entityId: `${roleKey}:${scope.scopeType}:${scope.schoolCode || scope.countryCode || "global"}`,
      schoolCode: scope.schoolCode,
      oldValue: { grants: beforeRows, scope },
      newValue: { grants: saved, scope },
    });
    for (const event of auditEvents) {
      await writeRbacAudit(scopeRepo, principal, auditMeta, {
        action: event.action,
        entityType: "role_module_permissions",
        entityId: `${roleKey}:${event.moduleKey}`,
        schoolCode: scope.schoolCode,
        oldValue: { moduleKey: event.moduleKey, field: event.field },
        newValue: { moduleKey: event.moduleKey, field: event.field, after: grants.find((g) => g.moduleKey === event.moduleKey) },
      });
    }

    const updatedAt = await scopedStore.maxUpdatedAtForScope({
      roleKey,
      scopeType: scope.scopeType,
      countryId: scope.countryId,
      schoolId: scope.schoolId,
    });
    return {
      roleKey,
      scopeType: scope.scopeType,
      countryCode: scope.countryCode,
      schoolCode: scope.schoolCode,
      updatedAt,
      grants: saved,
    };
  });
}

function addRoleKey(roleKeys, seen, value) {
  const { toRoleKey: toKey } = require("./userRoleLifecycle");
  const key = toKey(value);
  if (!key || key === "SANS_AFFECTATION") return;
  if (seen.has(key)) return;
  seen.add(key);
  roleKeys.push(key);
}

async function collectPrincipalRoleKeys(repo, principal) {
  const { principalHasRole } = require("./userRoleLifecycle");
  const roleKeys = [];
  const seen = new Set();

  const userId = asTrimmed(principal?.sub || principal?.id);
  let liveKeys = null;
  if (userId && typeof repo.listActiveUserRoleKeys === "function") {
    try {
      const loaded = await repo.listActiveUserRoleKeys(userId);
      if (Array.isArray(loaded)) liveKeys = loaded;
    } catch {
      liveKeys = null;
    }
  }

  const usedLiveRoles = Array.isArray(liveKeys) && liveKeys.length > 0;
  if (usedLiveRoles) {
    for (const value of liveKeys) addRoleKey(roleKeys, seen, value);
  } else {
    if (Array.isArray(principal?.roleKeys)) {
      for (const value of principal.roleKeys) addRoleKey(roleKeys, seen, value);
    }
    if (Array.isArray(principal?.roles)) {
      for (const value of principal.roles) addRoleKey(roleKeys, seen, value);
    }
    addRoleKey(roleKeys, seen, principal?.role);
    if (principalHasRole(principal, "Super Administrateur Somafrik")) {
      addRoleKey(roleKeys, seen, "SUPER_ADMIN");
    }
  }
  return roleKeys;
}

function syntheticGrantsFromLegacyMap(roleKeys, legacyMap, grantedRoleKeys) {
  const { toRoleLabel } = require("./userRoleLifecycle");
  const synthetic = [];
  for (const roleKey of roleKeys) {
    if (grantedRoleKeys.has(roleKey)) continue;
    const label = toRoleLabel(roleKey);
    const permissions = permissionList(legacyMap[label]).length
      ? legacyMap[label]
      : permissionList(legacyMap[roleKey]);
    const modulesCrud = parsePermissionStringsToModuleCrud(permissions);
    for (const module of listFunctionalModules()) {
      const crud = modulesCrud[module.moduleKey] || emptyCrud();
      if (!crud.canCreate && !crud.canRead && !crud.canUpdate && !crud.canDelete) continue;
      synthetic.push({
        roleKey,
        scopeType: "global",
        moduleKey: module.moduleKey,
        ...crud,
      });
    }
  }
  return synthetic;
}

async function resolveEffectivePermissionsForPrincipal(repo, principal) {
  let roleKeys = await collectPrincipalRoleKeys(repo, principal);
  let establishmentMap = {};
  try {
    establishmentMap = (await repo.getEstablishmentRolesStore?.().getPermissionsMap?.()) ?? {};
  } catch {
    establishmentMap = {};
  }
  roleKeys = applyEstablishmentCatalogFailClosed(roleKeys, establishmentMap);

  const store = rbacStore(repo);
  let schoolId = null;
  let countryId = null;
  const schoolCode = asTrimmed(principal?.schoolCode);
  if (schoolCode && schoolCode !== "*") {
    const resolved = await store.resolveCountryAndSchool({ schoolCode });
    schoolId = resolved.school?.id || null;
    countryId = resolved.school?.country_id || resolved.country?.id || null;
  } else if (asTrimmed(principal?.countryCode)) {
    const resolved = await store.resolveCountryAndSchool({ countryCode: principal.countryCode });
    countryId = resolved.country?.id || null;
  }

  const grantCount = await store.countActiveGrants();
  if (grantCount === 0) {
    const legacyMap = await loadLegacyRolePermissionMaps(repo);
    const { mergePermissionsForRoles } = require("./userRoleLifecycle");
    const permissions = mergePermissionsForRoles(roleKeys, legacyMap);
    return {
      roleKeys,
      permissions,
      modules: parsePermissionStringsToModuleCrud(permissions),
      source: "legacy-map-fallback",
      resolvedAt: new Date().toISOString(),
    };
  }

  const grants = await store.listGrantsForRoles(roleKeys);
  const grantedRoleKeys = new Set(
    grants.map((grant) => String(grant.roleKey || grant.role_key || "").toUpperCase()).filter(Boolean),
  );
  const missingRoleKeys = roleKeys.filter((roleKey) => !grantedRoleKeys.has(roleKey));
  let synthetic = [];
  if (missingRoleKeys.length) {
    const legacyMap = await loadLegacyRolePermissionMaps(repo);
    synthetic = syntheticGrantsFromLegacyMap(missingRoleKeys, legacyMap, new Set());
  }
  const resolved = resolveEffectivePermissionSet(roleKeys, [...grants, ...synthetic], { schoolId, countryId });
  return {
    ...resolved,
    source: synthetic.length ? "role_module_permissions+legacy-role-fallback" : "role_module_permissions",
    resolvedAt: new Date().toISOString(),
  };
}

async function archiveRbacRole(repo, roleId, principal, auditMeta) {
  assertSuperAdmin(principal);
  const existing = await repo.getEstablishmentRolesStore().getRoleById(roleId);
  if (!existing) {
    throw createFunctionalRbacError(404, "Rôle introuvable.", FUNCTIONAL_RBAC_ERROR.NOT_FOUND);
  }
  assertNotProtectedArchive(existing.roleCode || existing.roleName);
  const { archiveRole } = require("./establishmentRolesService");
  return archiveRole(repo, roleId, principal, auditMeta);
}

function getModuleOrThrow(moduleKey) {
  const module = getModuleByKey(moduleKey);
  if (!module) {
    throw createFunctionalRbacError(400, `module_key inconnu: ${moduleKey}`, FUNCTIONAL_RBAC_ERROR.INVALID_MODULE);
  }
  return module;
}

module.exports = {
  rbacStore,
  functionalRbacAuditMetaFromRequest,
  ensureFunctionalRbacBootstrap,
  listRbacCatalog,
  getConfiguredPermissions,
  getEffectivePermissionsConfigured,
  patchConfiguredPermissions,
  resolveEffectivePermissionsForPrincipal,
  archiveRbacRole,
  throwLegacyRolePermissionsWrite,
  getModuleOrThrow,
  mergeRolePermissionMaps,
  backfillMissingGlobalModuleGrants,
  reconcileCanonicalPlanningGrants,
  reconcileCanonicalRoomsReplacementsGrants,
};
