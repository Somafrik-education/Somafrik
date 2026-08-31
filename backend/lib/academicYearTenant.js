"use strict";

const { isV2SchoolLoginCode, normalizeSchoolCode } = require("./schoolCodeV2");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

function scopeDenied() {
  const error = new Error("Accès refusé: établissement hors périmètre.");
  error.statusCode = 403;
  error.code = "SCHOOL_SCOPE_FORBIDDEN";
  return error;
}

function schoolCountryIso(school = {}) {
  return String(school.country_iso || school.countryIso || school.countryCode || "")
    .trim()
    .toUpperCase();
}

function principalMayAccessSchool(principal, school, canonical) {
  if (!principal) return false;
  if (SUPER_ADMIN_ROLES.has(principal.role)) return true;
  if (principal.role === "Admin Pays") {
    const iso = schoolCountryIso(school);
    const country = String(principal.countryCode || "").trim().toUpperCase();
    return Boolean(iso && country && iso === country);
  }
  const jwt = normalizeSchoolCode(principal.schoolCode);
  if (jwt && jwt === canonical) return true;
  const effective = normalizeSchoolCode(principal.effectiveSchoolCode);
  if (effective && effective === canonical) return true;
  const memberId = String(principal.resolvedSchoolId || "").trim();
  return Boolean(memberId && String(school.id) === memberId);
}

async function resolveAcademicYearCreateTenant({
  principal,
  bodySchoolCode,
  getSchoolByLoginCode,
  getSchoolForPrincipalUser,
}) {
  const body = normalizeSchoolCode(bodySchoolCode);
  if (body && !isV2SchoolLoginCode(body)) {
    throw scopeDenied();
  }

  const memberSchool = typeof getSchoolForPrincipalUser === "function"
    ? await getSchoolForPrincipalUser(principal)
    : null;

  let school = null;
  if (body) {
    school = await getSchoolByLoginCode(body);
  } else {
    school = memberSchool;
  }

  const canonical = normalizeSchoolCode(school?.login_code);
  if (!school || !isV2SchoolLoginCode(canonical)) {
    throw scopeDenied();
  }
  if (body && body !== canonical) {
    throw scopeDenied();
  }

  const scopedPrincipal = {
    ...principal,
    resolvedSchoolId: memberSchool?.id || "",
  };
  if (!principalMayAccessSchool(scopedPrincipal, school, canonical)) {
    throw scopeDenied();
  }
  return { school, schoolCode: canonical };
}

module.exports = {
  resolveAcademicYearCreateTenant,
  principalMayAccessSchool,
};
