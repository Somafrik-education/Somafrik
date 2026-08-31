"use strict";

const { isV2SchoolLoginCode, normalizeSchoolCode } = require("./schoolCodeV2");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

function hasRequestSchoolScope(principal = {}) {
  return Boolean(
    principal.schoolScopeSource === "request" &&
      normalizeSchoolCode(principal.effectiveSchoolCode),
  );
}

function schoolCountryIso(row = {}) {
  return String(row.countryCode || row.country_code || row.countryIso || "")
    .trim()
    .toUpperCase();
}

function rowSchoolId(row = {}) {
  return String(row.schoolId || row.school_id || "").trim();
}

function rowLoginCode(row = {}) {
  return normalizeSchoolCode(row.schoolCode || row.school_code || row.login_code);
}

function principalMayReadAcademicYear(principal, row, memberSchool) {
  if (!principal) return false;
  const requestScoped = hasRequestSchoolScope(principal);
  const effective = normalizeSchoolCode(principal.effectiveSchoolCode);
  const rowLogin = rowLoginCode(row);

  if (requestScoped) {
    return Boolean(isV2SchoolLoginCode(effective) && effective === rowLogin);
  }

  if (SUPER_ADMIN_ROLES.has(principal.role)) return true;

  if (principal.role === "Admin Pays") {
    const iso = schoolCountryIso(row);
    const country = String(principal.countryCode || "").trim().toUpperCase();
    return Boolean(iso && country && iso === country);
  }

  const memberId = String(memberSchool?.id || "").trim();
  if (memberId && rowSchoolId(row) === memberId) return true;

  const memberLogin = normalizeSchoolCode(memberSchool?.login_code);
  return Boolean(isV2SchoolLoginCode(memberLogin) && memberLogin === rowLogin);
}

async function scopeAcademicYearList({ rows = [], principal, getSchoolForPrincipalUser }) {
  if (!principal) return rows;
  if (SUPER_ADMIN_ROLES.has(principal.role) && !hasRequestSchoolScope(principal)) {
    return rows;
  }

  const memberSchool = typeof getSchoolForPrincipalUser === "function"
    ? await getSchoolForPrincipalUser(principal)
    : null;

  return rows.filter((row) => principalMayReadAcademicYear(principal, row, memberSchool));
}

function findExistingAcademicYear(rows = [], name, schoolCode) {
  const wantedName = String(name ?? "").trim();
  const named = rows.filter((row) => String(row.name ?? "").trim() === wantedName);
  if (!named.length) return null;

  const requested = normalizeSchoolCode(schoolCode);
  if (isV2SchoolLoginCode(requested)) {
    return named.find((row) => rowLoginCode(row) === requested) ?? null;
  }

  const schoolIds = new Set(named.map((row) => rowSchoolId(row)).filter(Boolean));
  if (schoolIds.size === 1) return named[0];
  return null;
}

module.exports = {
  scopeAcademicYearList,
  findExistingAcademicYear,
  principalMayReadAcademicYear,
};
