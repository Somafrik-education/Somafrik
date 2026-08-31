"use strict";

/**
 * POST /backoffice/users — tenant établissement.
 * Admin School : users.school_id → schools.id, exposé via schools.login_code.
 * Aucun fallback positif leftover (schools.school_code). Superadmin / Admin Pays
 * conservent le body schoolCode + getSchoolByCode (leftover OR).
 */

const { isV2SchoolLoginCode, normalizeSchoolCode } = require("./schoolCodeV2");
const {
  asTrimmed,
  createClientsError,
  CLIENTS_ERROR,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
} = require("./clientsManagement");

function scopeDenied(status, message, code) {
  throw createClientsError(status, message, code);
}

function schoolLoginCode(school = {}) {
  return normalizeSchoolCode(school.login_code || school.loginCode || school.school_login_code);
}

function memberCountryCode(school = {}) {
  return normalizeSchoolCode(
    school.country_code || school.countryCode || school.country_iso || school.countryIso,
  );
}

function normalizeMemberSchool(school) {
  if (!school) return school;
  const countryCode = memberCountryCode(school);
  if (!countryCode) return school;
  return { ...school, country_code: countryCode };
}

async function resolveCreateUserTenant(store, principal, rawPayload = {}) {
  const bodySchool = normalizeSchoolCode(rawPayload.schoolCode || rawPayload.schoolId);

  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    if (!bodySchool || bodySchool === "*") {
      if (isSuperAdminPrincipal(principal)) return { school: null, schoolCode: "" };
      scopeDenied(400, "Établissement obligatoire.", CLIENTS_ERROR.INVALID_TENANT_SCOPE);
    }
    const school = await store.getSchoolByCode(bodySchool);
    if (!school) {
      scopeDenied(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
    }
    return { school: normalizeMemberSchool(school), schoolCode: schoolLoginCode(school) || bodySchool };
  }

  const rawMemberSchool = typeof store.getSchoolForPrincipalUser === "function"
    ? await store.getSchoolForPrincipalUser(principal)
    : null;
  const memberSchool = normalizeMemberSchool(rawMemberSchool);
  if (!memberSchool?.id) {
    scopeDenied(404, "Établissement introuvable.", CLIENTS_ERROR.TENANT_MISMATCH);
  }

  const memberLogin = schoolLoginCode(memberSchool);
  if (isV2SchoolLoginCode(bodySchool) && memberLogin && bodySchool !== memberLogin) {
    scopeDenied(403, "Accès refusé : établissement hors périmètre.", CLIENTS_ERROR.TENANT_MISMATCH);
  }

  return {
    school: memberSchool,
    schoolCode: memberLogin,
  };
}

module.exports = {
  resolveCreateUserTenant,
  normalizeMemberSchool,
};
