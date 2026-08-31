"use strict";

/**
 * POST /classes/:classCode/students — tenant établissement.
 * Admin School : users.school_id → schools.id, exposé via schools.login_code V2.
 * Aucun fallback positif leftover (schools.school_code).
 */

const { isV2SchoolLoginCode, normalizeSchoolCode } = require("./schoolCodeV2");

function tenantMismatch(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = "TENANT_MISMATCH";
  return error;
}

function schoolLoginCode(school) {
  const row = school || {};
  return normalizeSchoolCode(row.login_code || row.loginCode || row.school_login_code);
}

async function resolveEnrollmentTenant({ principal, getSchoolForPrincipalUser } = {}) {
  const memberSchool = typeof getSchoolForPrincipalUser === "function"
    ? await getSchoolForPrincipalUser(principal)
    : null;
  const login = schoolLoginCode(memberSchool);
  if (!memberSchool?.id || !isV2SchoolLoginCode(login)) {
    throw tenantMismatch(404, "Établissement introuvable.");
  }
  return {
    school: memberSchool,
    schoolCode: login,
  };
}

module.exports = {
  resolveEnrollmentTenant,
  schoolLoginCode,
};
