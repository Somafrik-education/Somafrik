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
  return `${alias}.login_code = ANY($${params.length}::text[])`;
}

function countryIsoFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  for (const value of [record.countryIso, record.country_iso, record.countryIsoCode, record.iso_code]) {
    const iso = String(value ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(iso)) return iso;
  }
  return "";
}

function schoolCodeInScope(schoolCode, scope, extras = {}) {
  if (scope.mode === "all") return true;
  if (scope.mode === "none") return false;
  if (scope.mode === "country") {
    const iso = String(extras.countryIso || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso)) return false;
    return iso === scope.countryCode;
  }
  const code = String(schoolCode || "").trim().toUpperCase();
  if (!code) return false;
  return scope.codes.includes(code);
}

function schoolRecordInFinanceScope(record, scope) {
  if (scope.mode === "all") return true;
  if (scope.mode === "none") return false;
  if (scope.mode === "country") {
    const iso = countryIsoFromRecord(record);
    return Boolean(iso) && iso === scope.countryCode;
  }
  const publicCode = String(record?.login_code || record?.loginCode || "").trim().toUpperCase();
  if (!publicCode) return false;
  return schoolCodeInScope(publicCode, scope);
}

/**
 * Identité établissement d'une fiche élève. Ne jamais lire `loginCode` /
 * `login_code` : sur l'élève ce sont l'identité personne (user_code / student_code).
 */
function studentSchoolPublicLogin(record = {}) {
  return String(
    record.school_login_code || record.schoolLoginCode || record.schoolCode || "",
  ).trim();
}

function studentRecordInFinanceScope(student, scope) {
  const login = studentSchoolPublicLogin(student);
  return schoolRecordInFinanceScope(
    {
      login_code: login,
      loginCode: login,
      countryIso: countryIsoFromRecord(student) || student.countryCode,
    },
    scope,
  );
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
  schoolRecordInFinanceScope,
  studentSchoolPublicLogin,
  studentRecordInFinanceScope,
  countryIsoFromRecord,
  primaryFinanceSchoolCode,
};
