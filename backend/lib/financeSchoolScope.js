"use strict";

const { TenantScopeService } = require("../services/tenantScopeService");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);
const tenantScope = new TenantScopeService();

function resolveFinanceSchoolScope(principal) {
  if (!principal) {
    return { mode: "all" };
  }
  const platform = SUPER_ADMIN_ROLES.has(principal.role);
  if (platform && !tenantScope.hasEffectiveSchoolScope(principal)) {
    return { mode: "all" };
  }
  if (principal.role === "Admin Pays" && !tenantScope.hasEffectiveSchoolScope(principal)) {
    const countryCode = String(principal.countryCode || "").trim().toUpperCase();
    if (!countryCode) return { mode: "none" };
    return { mode: "country", countryCode };
  }
  const codes = [...tenantScope.principalSchoolCodes(principal)];
  if (!codes.length) return { mode: "none" };
  return { mode: "schools", codes };
}

function sqlSchoolPredicate(alias, scope, params) {
  if (scope.mode === "all") return "TRUE";
  if (scope.mode === "none") return "FALSE";
  if (scope.mode === "country") {
    params.push(scope.countryCode);
    return `EXISTS (
      SELECT 1 FROM countries _fin_c
      WHERE _fin_c.id = ${alias}.country_id
        AND upper(btrim(_fin_c.iso_code)) = $${params.length}
    )`;
  }
  params.push(scope.codes);
  return `${alias}.school_code = ANY($${params.length}::text[])`;
}

function schoolCodeInScope(schoolCode, scope) {
  if (scope.mode === "all") return true;
  if (scope.mode === "none") return false;
  const code = String(schoolCode || "").trim().toUpperCase();
  if (!code) return false;
  if (scope.mode === "country") return code.slice(0, 2) === scope.countryCode;
  return scope.codes.includes(code);
}

function primaryFinanceSchoolCode(principal) {
  const scope = resolveFinanceSchoolScope(principal);
  if (scope.mode !== "schools" || !Array.isArray(scope.codes) || !scope.codes.length) {
    return "";
  }
  return scope.codes[0];
}

module.exports = {
  resolveFinanceSchoolScope,
  sqlSchoolPredicate,
  schoolCodeInScope,
  primaryFinanceSchoolCode,
};
