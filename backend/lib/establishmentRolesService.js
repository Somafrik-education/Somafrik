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
const {
  assertNotProtectedMutation,
  isProtectedSystemRole,
  RBAC_AUDIT_ACTIONS,
  sanitizeRbacAuditValue,
  rbacAuditActor,
} = require("./functionalRbacManagement");
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
  const actor = rbacAuditActor(principal);
  await tx.recordAudit(
    {
      schoolCode: entry.schoolCode || principal?.schoolCode,
      userId: principal?.sub || principal?.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId ?? ""),
      oldValue: sanitizeRbacAuditValue(entry.oldValue == null ? null : { ...actor, ...entry.oldValue }),
      newValue: sanitizeRbacAuditValue(entry.newValue == null ? null : { ...actor, ...entry.newValue }),
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    },
    tx,
  );
}

function roleAuditSnapshot(role) {
  return {
    roleId: role?.id ?? null,
    roleKey: String(role?.roleCode || "").toUpperCase() || null,
    roleCode: role?.roleCode ?? null,
    roleName: role?.roleName ?? null,
    scope: role?.scope ?? null,
    status: role?.status ?? null,
  };
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
  if (isPlatformRoleName(roleName) || isProtectedSystemRole(roleCode) || isProtectedSystemRole(roleName)) {
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
        action: RBAC_AUDIT_ACTIONS.ROLE_CREATE,
        entityType: "establishment_role",
        entityId: saved.id,
        newValue: roleAuditSnapshot(saved),
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
  assertNotProtectedMutation(existing.roleCode || existing.roleName, "renommés ou modifiés");
  const nextName = patch.roleName !== undefined ? asTrimmed(patch.roleName) : undefined;
  if (patch.roleName !== undefined && !nextName) {
    throw createEstablishmentRolesError(400, "Libellé de rôle obligatoire.");
  }
  const permissions = patch.permissions !== undefined ? sanitizePermissionList(patch.permissions) : undefined;
  const delegationPermissions =
    patch.delegationPermissions !== undefined ? sanitizePermissionList(patch.delegationPermissions) : undefined;
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = rolesStore(scope);
    const saved = await scopedStore.updateRole(roleId, {
      roleName: nextName,
      displayOrder: patch.displayOrder != null ? Number(patch.displayOrder) : undefined,
      schoolAssignable: patch.schoolAssignable,
      permissions,
      delegationPermissions,
    });
    if (!saved) {
      throw createEstablishmentRolesError(404, "Rôle introuvable ou archivé.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
    }
    const renamed = Boolean(nextName && nextName !== existing.roleName);
    await writeEstablishmentRolesAudit(scope, principal, auditMeta, {
      action: renamed ? RBAC_AUDIT_ACTIONS.ROLE_RENAME : "ROLE_UPDATED",
      entityType: "establishment_role",
      entityId: roleId,
      oldValue: roleAuditSnapshot(existing),
      newValue: roleAuditSnapshot({ ...saved, roleCode: existing.roleCode }),
    });
    return { ...saved, roleCode: existing.roleCode };
  });
}

async function updateRoleDisplayLabel(repo, roleId, rawPatch, principal, auditMeta) {
  assertSuperAdmin(principal);
  const store = rolesStore(repo);
  const existing = await store.getRoleById(roleId);
  if (!existing) {
    throw createEstablishmentRolesError(404, "Rôle introuvable.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
  }
  const { normalizeDisplayLabel } = require("./roleDisplayLabels");
  const nextLabel = normalizeDisplayLabel(rawPatch?.displayLabel ?? rawPatch?.display_label);
  const previous = existing.displayLabel ?? null;
  const resetting = nextLabel == null;
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = rolesStore(scope);
    const saved = await scopedStore.updateRoleDisplayLabel(roleId, nextLabel);
    if (!saved) {
      throw createEstablishmentRolesError(404, "Rôle introuvable.", ESTABLISHMENT_ROLES_ERROR.ROLE_NOT_FOUND);
    }
    await writeEstablishmentRolesAudit(scope, principal, auditMeta, {
      action: resetting ? RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_RESET : RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_UPDATE,
      entityType: "establishment_role",
      entityId: roleId,
      oldValue: {
        roleKey: existing.roleKey || String(existing.roleCode || "").toUpperCase(),
        oldDisplayLabel: previous,
        newDisplayLabel: nextLabel,
      },
      newValue: {
        roleKey: saved.roleKey || String(saved.roleCode || "").toUpperCase(),
        oldDisplayLabel: previous,
        newDisplayLabel: nextLabel,
      },
    });
    return saved;
  });
}

async function resetRoleDisplayLabel(repo, roleId, principal, auditMeta) {
  return updateRoleDisplayLabel(repo, roleId, { displayLabel: null }, principal, auditMeta);
}

async function listRoleDisplayLabels(repo, principal) {
  if (!principal) {
    throw createEstablishmentRolesError(403, "Accès refusé.", ESTABLISHMENT_ROLES_ERROR.FORBIDDEN);
  }
  const store = rolesStore(repo);
  if (typeof store.listRoleDisplayContracts === "function") {
    return store.listRoleDisplayContracts();
  }
  const roles = await store.listRoles({ includeArchived: true });
  return (roles ?? []).map((role) => ({
    roleKey: role.roleKey,
    defaultLabel: role.defaultLabel,
    displayLabel: role.displayLabel,
    effectiveLabel: role.effectiveLabel,
  }));
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
      action: RBAC_AUDIT_ACTIONS.ROLE_ARCHIVE,
      entityType: "establishment_role",
      entityId: roleId,
      oldValue: roleAuditSnapshot(existing),
      newValue: roleAuditSnapshot(saved),
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
  updateRoleDisplayLabel,
  resetRoleDisplayLabel,
  listRoleDisplayLabels,
  archiveRole,
  assertEstablishmentRoleAssignable,
  getCombinedRolePermissionsMap,
  ensureEstablishmentRolesConstraints,
  stripLegacyUserRolesPayloads,
};
