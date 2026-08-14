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
};
