"use strict";

/**
 * ADMIN-06B2 — scope établissement pour la console Conformité A2.
 * Ne duplique pas privacyErasure / data-export : JWT école uniquement.
 */

const { BusinessError } = require("../services/authService");
const { isPlatformAdminPrincipal } = require("./platformPersonalDataGuard");
const { PRIVACY_ERROR, sanitizePrivacyRequest } = require("./privacyErasure");

function asSchoolCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function schoolComplianceForbidden(message = "Périmètre établissement insuffisant.") {
  const error = new BusinessError(403, message);
  error.code = PRIVACY_ERROR.FORBIDDEN;
  return error;
}

function resolveSchoolComplianceScope(principal) {
  if (isPlatformAdminPrincipal(principal)) {
    throw schoolComplianceForbidden();
  }
  const schoolCode = asSchoolCode(principal?.schoolCode);
  if (!schoolCode || schoolCode === "*") {
    throw schoolComplianceForbidden();
  }
  return schoolCode;
}

async function listSchoolPrivacyRequests(repository, principal) {
  const schoolCode = resolveSchoolComplianceScope(principal);
  const { loadRoleDisplayIndexFromRepo } = require("./roleDisplayLabels");
  const displayIndex = await loadRoleDisplayIndexFromRepo(repository);
  const rows = await repository.listPrivacyRequests({ schoolCode });
  return (Array.isArray(rows) ? rows : [])
    .map((row) => sanitizePrivacyRequest(row, displayIndex))
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

module.exports = {
  resolveSchoolComplianceScope,
  listSchoolPrivacyRequests,
};
