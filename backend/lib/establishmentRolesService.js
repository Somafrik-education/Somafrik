"use strict";

const {
  ESTABLISHMENT_ROLES_ERROR,
  asTrimmed,
  normalizeRoleCode,
  createEstablishmentRolesError,
  assertSuperAdmin,
  sanitizePermissionList,
  isPlatformRoleName,
  isSuperAdminPrincipal,
} = require("./establishmentRolesManagement");
const { createEstablishmentRolesPgStore } = require("../db/establishmentRolesPgStore");

function rolesStore(repo) {
  if (typeof repo.getEstablishmentRolesStore === "function") {
    return repo.getEstablishmentRolesStore();
  }
  return createEstablishmentRolesPgStore(repo);
}

async function writeEstablishmentRolesAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordAudit !== "function") {
    throw createEstablishmentRolesError(500, "Audit indisponible dans la transaction.");
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

function buildSeedRolesFromData() {
  const { listCanonicalEstablishmentSeedRoles } = require("./canonicalSystemRoles");
  return listCanonicalEstablishmentSeedRoles();
}

async function ensureEstablishmentRolesBootstrap(repo) {
  const store = rolesStore(repo);
  await store.seedDefaultRolesIfEmpty(buildSeedRolesFromData());
  const { reconcileCanonicalSystemRoles } = require("./systemRolesReconciliation");
  await reconcileCanonicalSystemRoles(repo, { includeFunctionalGrants: false });
}

async function createRole(repo, rawPayload, principal, auditMeta) {
  assertSuperAdmin(principal);
  const payload = rawPayload ?? {};
  const roleName = asTrimmed(payload.roleName);
  const roleCode = normalizeRoleCode(payload.roleCode || roleName);
  if (!roleName || !roleCode) {
    throw createEstablishmentRolesError(400, "Nom et code de rôle obligatoires.");
  }
  if (isPlatformRoleName(roleName)) {
    throw createEstablishmentRolesError(403, "Rôle plateforme réservé.", ESTABLISHMENT_ROLES_ERROR.PERMISSION_FORBIDDEN);
  }
  const permissions = sanitizePermissionList(payload.permissions ?? []);
  const delegationPermissions = sanitizePermissionList(payload.delegationPermissions ?? permissions);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = rolesStore(scope);
    try {
      const saved = await scopedStore.insertRole({
        roleCode,
        roleName,
        scope: "school",
        displayOrder: Number(payload.displayOrder ?? 0),
        schoolAssignable: payload.schoolAssignable !== false,
        permissions,
        delegationPermissions,
      });
      await writeEstablishmentRolesAudit(scope, principal, auditMeta, {
        action: "ROLE_CREATED",
        entityType: "establishment_role",
        entityId: saved.id,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      if (error?.code === "23505") {
        throw createEstablishmentRolesError(409, "Rôle déjà existant.", ESTABLISHMENT_ROLES_ERROR.DUPLICATE);
      }
      throw error;
    }
  });
}

async function updateRole(repo, roleId, rawPatch, principal, auditMeta) {
  assertSuperAdmin(principal);
  const patch = rawPatch ?? {};
  const store = rolesStore(repo);
  const existing = await store.getRoleById(roleId);
  if (!existing) {
    throw createEstablishmentRolesError(404, "Rôle introuvable.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
  }
  const permissions = patch.permissions !== undefined ? sanitizePermissionList(patch.permissions) : undefined;
  const delegationPermissions =
    patch.delegationPermissions !== undefined ? sanitizePermissionList(patch.delegationPermissions) : undefined;
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = rolesStore(scope);
    const saved = await scopedStore.updateRole(roleId, {
      roleName: patch.roleName ? asTrimmed(patch.roleName) : undefined,
      displayOrder: patch.displayOrder != null ? Number(patch.displayOrder) : undefined,
      schoolAssignable: patch.schoolAssignable,
      permissions,
      delegationPermissions,
    });
    if (!saved) {
      throw createEstablishmentRolesError(404, "Rôle introuvable ou archivé.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
    }
    await writeEstablishmentRolesAudit(scope, principal, auditMeta, {
      action: "ROLE_UPDATED",
      entityType: "establishment_role",
      entityId: roleId,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function archiveRole(repo, roleId, principal, auditMeta) {
  assertSuperAdmin(principal);
  const store = rolesStore(repo);
  const existing = await store.getRoleById(roleId);
  if (!existing) {
    throw createEstablishmentRolesError(404, "Rôle introuvable.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
  }
  const { assertNotProtectedArchive } = require("./functionalRbacManagement");
  assertNotProtectedArchive(existing.roleCode || existing.roleName);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = rolesStore(scope);
    const saved = await scopedStore.archiveRole(roleId);
    if (!saved) {
      throw createEstablishmentRolesError(404, "Rôle introuvable ou déjà archivé.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
    }
    await writeEstablishmentRolesAudit(scope, principal, auditMeta, {
      action: "ROLE_ARCHIVED",
      entityType: "establishment_role",
      entityId: roleId,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function assertEstablishmentRoleAssignable(repo, roleLabel, principal) {
  const normalized = asTrimmed(roleLabel);
  if (!normalized || isPlatformRoleName(normalized)) {
    return normalized;
  }
  const store = rolesStore(repo);
  const role = await store.getRoleByNameOrCode(normalized);
  if (!role) {
    throw createEstablishmentRolesError(404, "Rôle inconnu.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
  }
  if (role.status !== "active") {
    throw createEstablishmentRolesError(409, "Rôle archivé.", ESTABLISHMENT_ROLES_ERROR.ROLE_ARCHIVED);
  }
  if (!role.schoolAssignable && !isSuperAdminPrincipal(principal)) {
    throw createEstablishmentRolesError(403, "Rôle non affectable.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_ASSIGNABLE);
  }
  return role.roleName;
}

async function getCombinedRolePermissionsMap(repo) {
  const establishmentMap = await rolesStore(repo).getPermissionsMap();
  const platformMap = (await repo.getPlatformRolePermissionsMap?.()) ?? (await repo.getRolePermissionsMap?.()) ?? {};
  return { ...platformMap, ...establishmentMap };
}

async function ensureEstablishmentRolesConstraints(repo, logger = console) {
  const store = rolesStore(repo);
  const ambiguous = await store.inventoryLegacyUserRolesPayloads();
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;
  logInfo(`[establishment-roles] inventaire legacy JSON userRoles : ${ambiguous.length} établissement(s)`);
  if (ambiguous.length > 0) {
    const details = ambiguous
      .slice(0, 5)
      .map((row) => `${row.schoolCode}(userRoles=${row.userRolesCount})`)
      .join("; ");
    const message =
      `Rôles établissement : ${ambiguous.length} établissement(s) ont encore userRoles dans school_academic_configs. ` +
      `Résolution explicite requise avant bascule canonique.` +
      (details ? ` Exemples: ${details}` : "");
    logError(`[establishment-roles] ${message}`);
    const error = new Error(message);
    error.name = "EstablishmentRolesConstraintsError";
    error.code = ESTABLISHMENT_ROLES_ERROR.LEGACY_ESTABLISHMENT_ROLES_AMBIGUOUS;
    error.inventory = { ambiguousSchools: ambiguous.length };
    throw error;
  }
}

async function stripLegacyUserRolesPayloads(repo) {
  const { STRIP_LEGACY_ACADEMIC_USER_ROLES_SQL } = require("../db/establishmentRolesSchema");
  await repo.query(STRIP_LEGACY_ACADEMIC_USER_ROLES_SQL);
}

module.exports = {
  buildSeedRolesFromData,
  ensureEstablishmentRolesBootstrap,
  createRole,
  updateRole,
  archiveRole,
  assertEstablishmentRoleAssignable,
  getCombinedRolePermissionsMap,
  ensureEstablishmentRolesConstraints,
  stripLegacyUserRolesPayloads,
};
