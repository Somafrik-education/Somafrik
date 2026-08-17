"use strict";

/**
 * Source unique des permissions obligatoires (invariants de rôle)
 * et des dépendances fonctionnelles intra-module.
 *
 * INTERDIT de dupliquer cette liste dans Web, Mobile ou data.js.
 * L'UI consomme GET /api/backoffice/rbac/catalog (mandatoryByRole + dependencies).
 *
 * Contrat réel (ne rien inventer) :
 * - SUPER_ADMIN : SUPER_ADMIN_INVARIANT_MODULES (Administration, utilisateurs, pays,
 *   établissements, référentiels). ALL_PRIVILEGES est un jeton runtime, pas une case CRUD.
 * - COUNTRY_ADMIN / SCHOOL_ADMIN : aucun invariant CRUD PATCH aujourd'hui
 *   (rôles protégés à l'archivage + jetons COUNTRY_PRIVILEGES / SCHOOL_PRIVILEGES au runtime).
 * - Dépendances intra-module : CREATE / UPDATE / DELETE exigent READ.
 *   Preuve : PermissionRoute + listes métier (Élèves, Enseignants, Présences…)
 *   refusent d'ouvrir l'écran sans canRead. Pas de matrice cross-module inventée ici.
 */

const {
  FUNCTIONAL_RBAC_ERROR,
  SUPER_ADMIN_INVARIANT_MODULES,
  createFunctionalRbacError,
} = require("./functionalRbacManagement");
const { toRoleKey } = require("./userRoleLifecycle");
const { CRUD_ACTIONS, listFunctionalModules } = require("./functionalModulesCatalog");

const CRUD_ACTIONS_LOWER = Object.freeze(["create", "read", "update", "delete"]);

const FLAG_BY_ACTION = Object.freeze({
  create: "canCreate",
  read: "canRead",
  update: "canUpdate",
  delete: "canDelete",
});

const LOCK_KIND = Object.freeze({
  ROLE_INVARIANT: "role_invariant",
  DEPENDENCY: "dependency",
});

const MANDATORY_PERMISSION_MESSAGE =
  "Permission obligatoire pour le fonctionnement de ce rôle";

const DEPENDENCY_PERMISSION_MESSAGE =
  "Impossible d'activer CREATE, UPDATE ou DELETE sans READ sur le même module.";

/**
 * CREATE / UPDATE / DELETE → READ.
 * Dérivé du comportement UI réel (écran inaccessible sans READ).
 */
const MODULE_ACTION_DEPENDENCIES = Object.freeze({
  create: Object.freeze(["read"]),
  update: Object.freeze(["read"]),
  delete: Object.freeze(["read"]),
});

function emptyActionFlags() {
  return { create: false, read: false, update: false, delete: false };
}

function crudToActionFlags(crud = {}) {
  return {
    create: Boolean(crud.canCreate),
    read: Boolean(crud.canRead),
    update: Boolean(crud.canUpdate),
    delete: Boolean(crud.canDelete),
  };
}

function actionFlagsToCrud(flags = {}) {
  return {
    canCreate: Boolean(flags.create),
    canRead: Boolean(flags.read),
    canUpdate: Boolean(flags.update),
    canDelete: Boolean(flags.delete),
  };
}

function normalizeRoleKey(roleKey) {
  return String(toRoleKey(roleKey) || "").toUpperCase();
}

/**
 * Invariants CRUD par rôle. Map moduleKey → { create, read, update, delete }.
 * Rôles sans contrat produit explicite → {}.
 */
function mandatoryPermissionsForRole(roleKey) {
  const key = normalizeRoleKey(roleKey);
  if (key !== "SUPER_ADMIN") return {};
  const out = {};
  for (const [moduleKey, flags] of Object.entries(SUPER_ADMIN_INVARIANT_MODULES)) {
    out[moduleKey] = Object.freeze(crudToActionFlags(flags));
  }
  return out;
}

function mandatoryByRoleDto() {
  return Object.freeze({
    SUPER_ADMIN: mandatoryPermissionsForRole("SUPER_ADMIN"),
    COUNTRY_ADMIN: {},
    SCHOOL_ADMIN: {},
  });
}

function catalogModuleExtras() {
  return {
    actions: [...CRUD_ACTIONS_LOWER],
    dependencies: { ...MODULE_ACTION_DEPENDENCIES },
  };
}

function enrichCatalogModules(modules = []) {
  const extras = catalogModuleExtras();
  const rows = Array.isArray(modules) && modules.length ? modules : listFunctionalModules();
  return rows.map((module) => ({
    ...module,
    actions: extras.actions,
    dependencies: extras.dependencies,
  }));
}

function overlayMandatoryFlags(roleKey, moduleKey, crud) {
  const mandatory = mandatoryPermissionsForRole(roleKey)[moduleKey];
  if (!mandatory) return { ...crud };
  return {
    canCreate: Boolean(crud.canCreate) || Boolean(mandatory.create),
    canRead: Boolean(crud.canRead) || Boolean(mandatory.read),
    canUpdate: Boolean(crud.canUpdate) || Boolean(mandatory.update),
    canDelete: Boolean(crud.canDelete) || Boolean(mandatory.delete),
  };
}

function describeActionLocks({ roleKey, moduleKey, flags = {} }) {
  const mandatory = mandatoryPermissionsForRole(roleKey)[moduleKey] || emptyActionFlags();
  const dependentActive = Boolean(flags.canCreate || flags.canUpdate || flags.canDelete);
  const locks = {};
  for (const action of CRUD_ACTIONS_LOWER) {
    if (mandatory[action]) {
      locks[action] = { locked: true, reason: LOCK_KIND.ROLE_INVARIANT };
      continue;
    }
    if (action === "read" && dependentActive) {
      locks[action] = { locked: true, reason: LOCK_KIND.DEPENDENCY };
      continue;
    }
    locks[action] = { locked: false, reason: null };
  }
  return locks;
}

function moduleContractDto(roleKey, moduleKey, flags = {}) {
  const mandatory = mandatoryPermissionsForRole(roleKey)[moduleKey] || emptyActionFlags();
  return {
    mandatory,
    dependencies: { ...MODULE_ACTION_DEPENDENCIES },
    locks: describeActionLocks({ roleKey, moduleKey, flags }),
  };
}

function requiredByActions(grant) {
  const requiredBy = [];
  if (grant.canCreate) requiredBy.push("create");
  if (grant.canUpdate) requiredBy.push("update");
  if (grant.canDelete) requiredBy.push("delete");
  return requiredBy;
}

function throwMandatoryPermission({ roleKey, moduleKey, action, lockKind, requiredBy, message }) {
  const details = {
    roleKey: normalizeRoleKey(roleKey),
    moduleKey,
    action,
    lockKind,
  };
  if (requiredBy?.length) details.requiredBy = requiredBy;
  if (normalizeRoleKey(roleKey) === "SUPER_ADMIN" && lockKind === LOCK_KIND.ROLE_INVARIANT) {
    details.legacyCode = FUNCTIONAL_RBAC_ERROR.SUPER_ADMIN_INVARIANT;
  }
  throw createFunctionalRbacError(
    409,
    message || MANDATORY_PERMISSION_MESSAGE,
    FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION,
    details,
  );
}

/**
 * Refuse toute écriture qui casse un invariant de rôle ou une dépendance CRUD.
 * Aucune normalisation silencieuse.
 */
function assertMandatoryPermissionPatch(roleKey, grants = []) {
  const key = normalizeRoleKey(roleKey);
  for (const grant of grants) {
    const moduleKey = grant.moduleKey;
    const mandatory = mandatoryPermissionsForRole(key)[moduleKey];
    if (mandatory) {
      for (const action of CRUD_ACTIONS_LOWER) {
        const flag = FLAG_BY_ACTION[action];
        if (mandatory[action] && grant[flag] === false) {
          throwMandatoryPermission({
            roleKey: key,
            moduleKey,
            action,
            lockKind: LOCK_KIND.ROLE_INVARIANT,
            message: `${MANDATORY_PERMISSION_MESSAGE} (${moduleKey}:${action.toUpperCase()}).`,
          });
        }
      }
    }
    const requiredBy = requiredByActions(grant);
    if (requiredBy.length && grant.canRead === false) {
      throwMandatoryPermission({
        roleKey: key,
        moduleKey,
        action: "read",
        lockKind: LOCK_KIND.DEPENDENCY,
        requiredBy,
        message: DEPENDENCY_PERMISSION_MESSAGE,
      });
    }
  }
}

function assertSuperAdminInvariantPatch(roleKey, grants = []) {
  assertMandatoryPermissionPatch(roleKey, grants);
}

module.exports = {
  CRUD_ACTIONS,
  CRUD_ACTIONS_LOWER,
  FLAG_BY_ACTION,
  LOCK_KIND,
  MODULE_ACTION_DEPENDENCIES,
  MANDATORY_PERMISSION_MESSAGE,
  DEPENDENCY_PERMISSION_MESSAGE,
  emptyActionFlags,
  crudToActionFlags,
  actionFlagsToCrud,
  mandatoryPermissionsForRole,
  mandatoryByRoleDto,
  catalogModuleExtras,
  enrichCatalogModules,
  overlayMandatoryFlags,
  describeActionLocks,
  moduleContractDto,
  assertMandatoryPermissionPatch,
  assertSuperAdminInvariantPatch,
};
