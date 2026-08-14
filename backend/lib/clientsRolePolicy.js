"use strict";

const {
  ROLE_TO_DB,
  ROLE_FROM_DB,
  asTrimmed,
  createClientsError,
  CLIENTS_ERROR,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
} = require("./clientsManagement");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);
const COUNTRY_ADMIN_ROLE = "Admin Pays";
const PROVISION_CONTACT_ROLE = "Parent";

const USER_PROFILE_PATCH_ALLOWLIST = new Set(["photoUrl"]);

const FORBIDDEN_USER_PROFILE_PATCH_KEYS = new Set([
  "permissions",
  "identifier",
  "countryScope",
  "countryCode",
  "accessChannel",
  "createdBy",
  "role",
  "history",
]);

function normalizeAssignableRole(role) {
  const trimmed = asTrimmed(role);
  if (!trimmed) {
    return "";
  }
  if (ROLE_FROM_DB[trimmed]) {
    return ROLE_FROM_DB[trimmed];
  }
  const upper = trimmed.toUpperCase();
  if (ROLE_FROM_DB[upper]) {
    return ROLE_FROM_DB[upper];
  }
  if (ROLE_TO_DB[trimmed]) {
    return trimmed;
  }
  return trimmed;
}

function isSuperAdminRole(roleLabel) {
  return SUPER_ADMIN_ROLES.has(normalizeAssignableRole(roleLabel));
}

function isCountryAdminRole(roleLabel) {
  return normalizeAssignableRole(roleLabel) === COUNTRY_ADMIN_ROLE;
}

/**
 * Politique serveur des rôles attribuables par principal.
 * Rejette avec 403 avant toute mutation (hors transaction).
 */
function assertAssignableUserRole(principal, role) {
  const normalizedRole = normalizeAssignableRole(role);
  if (!normalizedRole) {
    throw createClientsError(400, "Rôle obligatoire.");
  }

  if (isSuperAdminRole(normalizedRole) && !isSuperAdminPrincipal(principal)) {
    throw createClientsError(403, "Rôle non autorisé pour ce principal.", CLIENTS_ERROR.FORBIDDEN);
  }

  if (isCountryAdminRole(normalizedRole) && !isSuperAdminPrincipal(principal)) {
    throw createClientsError(403, "Rôle non autorisé pour ce principal.", CLIENTS_ERROR.FORBIDDEN);
  }

  if (!ROLE_TO_DB[normalizedRole] && !Object.values(ROLE_FROM_DB).includes(normalizedRole)) {
    throw createClientsError(400, "Rôle inconnu.");
  }

  return normalizedRole;
}

/**
 * Provisionnement contact → compte : uniquement Parent.
 */
function assertProvisionContactRole(role) {
  const normalizedRole = normalizeAssignableRole(role || PROVISION_CONTACT_ROLE);
  if (normalizedRole !== PROVISION_CONTACT_ROLE) {
    throw createClientsError(
      403,
      "Le provisionnement contact est réservé au rôle Parent.",
      CLIENTS_ERROR.FORBIDDEN,
    );
  }
  return PROVISION_CONTACT_ROLE;
}

function toDbRole(roleLabel) {
  const normalized = normalizeAssignableRole(roleLabel);
  return ROLE_TO_DB[normalized] ?? normalized;
}

function resolveUserRoleLabel(existing = {}) {
  return normalizeAssignableRole(ROLE_FROM_DB[existing.role] ?? existing.role);
}

function isPrivilegedUserRole(roleLabel) {
  return isSuperAdminRole(roleLabel) || isCountryAdminRole(roleLabel);
}

function assertSafeUserProfilePatch(profilePatch) {
  if (!profilePatch || typeof profilePatch !== "object" || Array.isArray(profilePatch)) {
    return;
  }

  for (const key of Object.keys(profilePatch)) {
    if (FORBIDDEN_USER_PROFILE_PATCH_KEYS.has(key)) {
      throw createClientsError(403, `Champ profil interdit: ${key}.`, CLIENTS_ERROR.FORBIDDEN);
    }
    if (!USER_PROFILE_PATCH_ALLOWLIST.has(key)) {
      throw createClientsError(403, `Champ profil non autorisé: ${key}.`, CLIENTS_ERROR.FORBIDDEN);
    }
  }
}

const USER_VALIDATION_PROFILE_KEYS = [
  "validationStatus",
  "validationRequestedBy",
  "validationRequestedAt",
  "validatedBy",
  "validatedAt",
  "history",
];

function mergeUserProfileForUpdate(existingProfile, patch = {}) {
  const merged = { ...existingProfile };
  if (patch.profile && typeof patch.profile === "object") {
    for (const key of USER_PROFILE_PATCH_ALLOWLIST) {
      if (patch.profile[key] !== undefined) {
        merged[key] = patch.profile[key];
      }
    }
  }
  if (patch.contactId !== undefined) {
    merged.contactId = patch.contactId;
  }
  if (patch.secondaryRoles !== undefined) {
    merged.secondaryRoles = patch.secondaryRoles;
  }
  for (const key of USER_VALIDATION_PROFILE_KEYS) {
    if (patch[key] !== undefined) {
      merged[key] = patch[key];
    }
  }
  delete merged.permissions;
  return merged;
}

/**
 * Empêche la modification silencieuse d'un compte privilégié (profil/permissions sans patch.role).
 */
function assertWritableUserTarget(principal, existing, patch = {}) {
  const targetRole = resolveUserRoleLabel(existing);
  const privileged = isPrivilegedUserRole(targetRole);

  if (privileged && patch.role === undefined && !isSuperAdminPrincipal(principal)) {
    throw createClientsError(
      403,
      "Compte privilégié : modification du rôle requise.",
      CLIENTS_ERROR.FORBIDDEN,
    );
  }

  if (isSuperAdminPrincipal(principal)) {
    return;
  }

  if (isSuperAdminRole(targetRole)) {
    throw createClientsError(403, "Compte Super Administrateur non modifiable.", CLIENTS_ERROR.FORBIDDEN);
  }

  if (!isCountryAdminPrincipal(principal) && isCountryAdminRole(targetRole)) {
    throw createClientsError(403, "Compte Admin Pays non modifiable.", CLIENTS_ERROR.FORBIDDEN);
  }
}

function assertSafeUserPatch(principal, existing, patch = {}) {
  if (patch.permissions !== undefined) {
    throw createClientsError(403, "Champ permissions non modifiable.", CLIENTS_ERROR.FORBIDDEN);
  }
  assertSafeUserProfilePatch(patch.profile);
  assertWritableUserTarget(principal, existing, patch);
}

module.exports = {
  SUPER_ADMIN_ROLES,
  COUNTRY_ADMIN_ROLE,
  PROVISION_CONTACT_ROLE,
  normalizeAssignableRole,
  isSuperAdminRole,
  isCountryAdminRole,
  assertAssignableUserRole,
  assertProvisionContactRole,
  toDbRole,
  USER_PROFILE_PATCH_ALLOWLIST,
  FORBIDDEN_USER_PROFILE_PATCH_KEYS,
  resolveUserRoleLabel,
  isPrivilegedUserRole,
  assertSafeUserProfilePatch,
  mergeUserProfileForUpdate,
  assertWritableUserTarget,
  assertSafeUserPatch,
};
