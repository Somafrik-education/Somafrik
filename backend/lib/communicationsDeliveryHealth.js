"use strict";

/**
 * Lot K — diagnostic deliveries PUSH/EMAIL sans PII.
 * Superadmin : vue globale.
 * Admin Pays : un seul iso_code distinct (countryCode / countryScope / platformContext).
 * Admin School : school_id de session uniquement.
 */

const { uuidOrNull } = require("./principalIdentity");
const { getCountryCodeFromScope } = require("./countryScope");
const { createSqlDeliveryAdapter } = require("./communicationChannelFanout");

function principalRoleKeys(principal) {
  return Array.isArray(principal?.roleKeys) ? principal.roleKeys.map((item) => String(item)) : [];
}

function isSuperAdminPrincipal(principal) {
  const role = String(principal?.role || "");
  const keys = principalRoleKeys(principal);
  return (
    role === "Super Administrateur Somafrik" ||
    role === "Super Administrateur OKAFRIK" ||
    keys.includes("SUPER_ADMIN")
  );
}

function isCountryAdminPrincipal(principal) {
  const role = String(principal?.role || "");
  const keys = principalRoleKeys(principal);
  return role === "Admin Pays" || keys.includes("COUNTRY_ADMIN");
}

function isSchoolAdminPrincipal(principal) {
  const role = String(principal?.role || "");
  const keys = principalRoleKeys(principal);
  return role === "Admin School" || keys.includes("SCHOOL_ADMIN");
}

function canReadDeliveryHealth(principal) {
  return isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal) || isSchoolAdminPrincipal(principal);
}

function resolvePrincipalCountryIso(principal) {
  const ctx = principal?.platformContext;
  const distinct = [
    ...new Set(
      [
        getCountryCodeFromScope(principal?.countryCode),
        getCountryCodeFromScope(principal?.countryScope),
        getCountryCodeFromScope(ctx?.countryCode),
      ].filter(Boolean),
    ),
  ];
  return distinct.length === 1 ? distinct[0] : "";
}

function resolveDeliveryHealthScope(principal) {
  if (!principal) return { mode: "none" };
  if (isSuperAdminPrincipal(principal)) {
    return { mode: "all" };
  }
  if (isCountryAdminPrincipal(principal)) {
    const countryCode = resolvePrincipalCountryIso(principal);
    if (!countryCode) return { mode: "none" };
    return { mode: "country", countryCode };
  }
  if (isSchoolAdminPrincipal(principal)) {
    const schoolId = uuidOrNull(
      principal.schoolId || principal.school_id || principal.effectiveSchoolId,
    );
    if (!schoolId) return { mode: "none" };
    return { mode: "school", schoolId };
  }
  return { mode: "none" };
}

function forbidden() {
  const error = new Error("Forbidden");
  error.statusCode = 403;
  return error;
}

async function readDeliveryHealth(store, principal) {
  if (!canReadDeliveryHealth(principal)) throw forbidden();
  const scope = resolveDeliveryHealthScope(principal);
  if (!scope || scope.mode === "none") throw forbidden();
  if (store && typeof store.listDeliveryHealth === "function") {
    return store.listDeliveryHealth(scope);
  }
  const adapter = createSqlDeliveryAdapter(store);
  return adapter.listDeliveryHealth(scope);
}

module.exports = {
  canReadDeliveryHealth,
  resolveDeliveryHealthScope,
  resolvePrincipalCountryIso,
  readDeliveryHealth,
};
