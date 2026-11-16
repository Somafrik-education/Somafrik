"use strict";

/**
 * P1-12 — ALL_PRIVILEGES seul n'est pas une autorité school-domain.
 *
 * Le jeton ouvre encore les fonctions plateforme et, pour un rôle
 * établissement réel, les routes scolaires. Sans ce rôle, il est ignoré
 * sur le catalogue de données personnelles et sur la Finance live.
 * Agent / schoolCode "*" ne deviennent pas Admin School.
 */

const { isSchoolPersonalDataRoute } = require("./platformPersonalDataGuard");
const { isFinanceLiveRbacRouteKey } = require("./financeRbacRouteMatrix");
const { toRoleKey } = require("./userRoleLifecycle");

const SCHOOL_BOUND_ROLE_KEYS = new Set([
  "SCHOOL_ADMIN",
  "PROVISEUR",
  "PRINCIPAL",
  "PREFET_ETUDES",
  "ACCOUNTANT",
  "SECRETARY",
  "SUPERVISOR",
  "TEACHER",
  "PARENT",
  "STUDENT",
]);

const EXTRA_SCHOOL_ROLE_KEYS = Object.freeze({
  prefet: "PREFET_ETUDES",
  parent_student: "PARENT",
});

function pushRoleToken(tokens, value) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number") {
    tokens.push(value);
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) return;
  pushRoleToken(tokens, value.role);
  pushRoleToken(tokens, value.roleKey);
  pushRoleToken(tokens, value.role_key);
  pushRoleToken(tokens, value.key);
  pushRoleToken(tokens, value.code);
}

function collectRoleTokens(principal) {
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

function roleKeyFromToken(token) {
  const raw = String(token ?? "").trim();
  if (!raw) return "";
  const extra = EXTRA_SCHOOL_ROLE_KEYS[raw.toLowerCase()];
  if (extra) return extra;
  return toRoleKey(raw);
}

function hasBackendSchoolBoundRole(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) return false;
  return collectRoleTokens(principal).some((token) => SCHOOL_BOUND_ROLE_KEYS.has(roleKeyFromToken(token)));
}

function isAllPrivilegesSchoolDomainRoute(routeKey) {
  return isSchoolPersonalDataRoute(routeKey) || isFinanceLiveRbacRouteKey(routeKey);
}

/**
 * Retire ALL_PRIVILEGES du jeu effectif quand la route est scolaire et que
 * le principal n'a pas de rôle établissement. Les autres jetons restent.
 */
function omitAllPrivilegesForUnboundSchoolDomain(principal, routeKey, permissions) {
  if (!(permissions instanceof Set)) return permissions;
  if (!permissions.has("ALL_PRIVILEGES")) return permissions;
  if (!isAllPrivilegesSchoolDomainRoute(routeKey)) return permissions;
  if (hasBackendSchoolBoundRole(principal)) return permissions;
  const next = new Set(permissions);
  next.delete("ALL_PRIVILEGES");
  return next;
}

module.exports = {
  SCHOOL_BOUND_ROLE_KEYS,
  hasBackendSchoolBoundRole,
  isAllPrivilegesSchoolDomainRoute,
  omitAllPrivilegesForUnboundSchoolDomain,
};
