"use strict";

/**
 * SEC-TENANT-01 — portée établissement fail-closed.
 *
 * Seuls les rôles plateforme (Superadmin, Admin Pays) peuvent porter la portée
 * établissement "*". Tout autre rôle est scolaire : il exige un rattachement
 * établissement concret. Un rattachement manquant ne devient jamais "*".
 *
 * Module sans dépendance métier pour rester importable depuis authService.
 */

const { isSuperAdminPrincipal } = require("./superadminPrincipal");

const PLATFORM_SCHOOL_SCOPE = "*";

const COUNTRY_ADMIN_TOKENS = new Set(["admin pays", "country_admin"]);

/** Rôle « sans affectation » : aucun rôle scolaire, donc aucune exigence de rattachement. */
const UNASSIGNED_ROLE_TOKENS = new Set(["", "sans affectation"]);

function asToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function principalRoleTokens(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) return [];
  const tokens = [principal.role, principal.roleKey, principal.role_key];
  if (Array.isArray(principal.roleKeys)) tokens.push(...principal.roleKeys);
  if (Array.isArray(principal.roles)) tokens.push(...principal.roles);
  return tokens
    .map((value) => (value && typeof value === "object" ? value.role ?? value.roleKey ?? value.role_key : value))
    .map(asToken);
}

function isCountryAdminPrincipal(principal) {
  return principalRoleTokens(principal).some((token) => COUNTRY_ADMIN_TOKENS.has(token));
}

/** Superadmin ou Admin Pays : seuls rôles autorisés à porter schoolCode "*". */
function isPlatformScopePrincipal(principal) {
  return isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal);
}

/** Principal porteur d'au moins un rôle scolaire (ni plateforme, ni sans affectation). */
function isSchoolRolePrincipal(principal) {
  if (isPlatformScopePrincipal(principal)) return false;
  return principalRoleTokens(principal).some((token) => !UNASSIGNED_ROLE_TOKENS.has(token));
}

function hasConcreteSchoolCode(value) {
  const code = String(value ?? "").trim();
  return Boolean(code) && code !== PLATFORM_SCHOOL_SCOPE;
}

module.exports = {
  PLATFORM_SCHOOL_SCOPE,
  isCountryAdminPrincipal,
  isPlatformScopePrincipal,
  isSchoolRolePrincipal,
  hasConcreteSchoolCode,
};
