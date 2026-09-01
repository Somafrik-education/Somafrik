"use strict";

const { BusinessError } = require("../services/authService");
const { matchesSchoolLookup } = require("./schoolCodeV2");

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function sameSchoolId(left, right) {
  const a = asTrimmed(left).toLowerCase();
  const b = asTrimmed(right).toLowerCase();
  return Boolean(a && b && a === b);
}

function isSuperAdminPrincipal(principal) {
  const role = asTrimmed(principal?.role);
  return role === "Super Administrateur Somafrik" || role === "Super Administrateur OKAFRIK";
}

function isCountryAdminPrincipal(principal) {
  return asTrimmed(principal?.role) === "Admin Pays";
}

function resolvePrincipalCountryCode(principal) {
  return asTrimmed(principal?.countryCode || principal?.countryScope).toUpperCase();
}

/**
 * SCHOOL_ADMIN : uniquement son tenant (UUID membership si présent,
 * sinon lookup leftover / login_code / publicId). Jamais un autre schoolCode.
 */
function assertSubscriptionAccessForPrincipal(principal, requestedSchoolCode, school) {
  if (isSuperAdminPrincipal(principal)) return;

  if (isCountryAdminPrincipal(principal)) {
    const principalCountry = resolvePrincipalCountryCode(principal);
    const schoolCountry = asTrimmed(school?.country_code || school?.countryCode).toUpperCase();
    if (!school || !principalCountry || schoolCountry !== principalCountry) {
      throw new BusinessError(403, "Accès refusé : établissement hors périmètre pays.");
    }
    return;
  }

  if (!school) {
    throw new BusinessError(403, "Accès refusé : établissement hors périmètre.");
  }

  const membershipId = asTrimmed(principal?.effectiveSchoolId || principal?.schoolId);
  if (membershipId) {
    if (!sameSchoolId(membershipId, school.id || school.schoolId || school.school_id)) {
      throw new BusinessError(403, "Accès refusé : établissement hors périmètre.");
    }
    return;
  }

  const owns =
    matchesSchoolLookup(school, principal?.schoolCode) ||
    matchesSchoolLookup(school, principal?.effectiveSchoolCode) ||
    matchesSchoolLookup(school, principal?.schoolPublicCode);
  if (!owns) {
    throw new BusinessError(403, "Accès refusé : établissement hors périmètre.");
  }
}

module.exports = {
  assertSubscriptionAccessForPrincipal,
  sameSchoolId,
};
