"use strict";

/**
 * P1-02 — autorité canonique Backend : un principal est Superadmin
 * uniquement par son rôle d'authentification, jamais par ALL_PRIVILEGES
 * ni par schoolCode "*".
 *
 * Contrat :
 * - clé PostgreSQL : SUPER_ADMIN
 * - rôle humain : Super Administrateur Somafrik
 * - Mobile : super_admin
 * - alias historique encore vu en JWT : Super Administrateur OKAFRIK
 *
 * Le login `superadmin` n'est pas une preuve de rôle à lui seul.
 *
 * Ne pas brancher ce helper pour *accorder* `mode: all` sur un scope
 * school-domain (users/presence/academicYear/enrollment). Superadmin n'est
 * pas un Admin School global. Planning / mobileSync sont fail-closed (P1-06).
 */

const SUPER_ADMIN_ROLE_LABELS = Object.freeze([
  "Super Administrateur Somafrik",
  "Super Administrateur OKAFRIK",
]);

const SUPER_ADMIN_ROLE_KEYS = Object.freeze(["SUPER_ADMIN"]);

const SUPER_ADMIN_ROLE_ALIASES = Object.freeze(["super_admin"]);

const SUPER_ADMIN_ROLES = new Set(SUPER_ADMIN_ROLE_LABELS);

const LABEL_SET = new Set(SUPER_ADMIN_ROLE_LABELS);
const KEY_SET = new Set(SUPER_ADMIN_ROLE_KEYS);
const ALIAS_SET = new Set(SUPER_ADMIN_ROLE_ALIASES);

function asToken(value) {
  return String(value ?? "").trim();
}

function isSuperAdminRoleToken(value) {
  const raw = asToken(value);
  if (!raw) return false;
  if (LABEL_SET.has(raw)) return true;
  if (KEY_SET.has(raw.toUpperCase())) return true;
  if (ALIAS_SET.has(raw) || ALIAS_SET.has(raw.toLowerCase())) return true;
  return false;
}

function pushRoleToken(tokens, value) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number") {
    tokens.push(value);
    return;
  }
  if (typeof value !== "object") return;
  pushRoleToken(tokens, value.role);
  pushRoleToken(tokens, value.roleKey);
  pushRoleToken(tokens, value.role_key);
  pushRoleToken(tokens, value.key);
  pushRoleToken(tokens, value.code);
}

function collectPrincipalRoleTokens(principal) {
  const tokens = [];
  pushRoleToken(tokens, principal.role);
  pushRoleToken(tokens, principal.roleKey);
  pushRoleToken(tokens, principal.role_key);
  if (Array.isArray(principal.roleKeys)) {
    for (const item of principal.roleKeys) pushRoleToken(tokens, item);
  }
  if (Array.isArray(principal.roles)) {
    for (const item of principal.roles) pushRoleToken(tokens, item);
  }
  return tokens;
}

function isSuperAdminPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    return false;
  }
  return collectPrincipalRoleTokens(principal).some(isSuperAdminRoleToken);
}

module.exports = {
  isSuperAdminPrincipal,
  isSuperAdminRoleToken,
  SUPER_ADMIN_ROLE_LABELS,
  SUPER_ADMIN_ROLE_KEYS,
  SUPER_ADMIN_ROLE_ALIASES,
  SUPER_ADMIN_ROLES,
};
