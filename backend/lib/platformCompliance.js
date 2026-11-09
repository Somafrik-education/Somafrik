"use strict";

/**
 * ADMIN-06B1 — Conformité plateforme A1, projection globale STRICTEMENT NON-PII.
 *
 * Superadmin uniquement. Aucune ligne privacy_requests / audit_logs.
 * Aucun identifiant établissement, personne, jeton ou secret.
 */

const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const { SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM } = require("./platformPersonalDataGuard");

const PLATFORM_COMPLIANCE_DENIED = "PLATFORM_COMPLIANCE_DENIED";
const PLATFORM_COMPLIANCE_INVARIANT_MISSING = "PLATFORM_COMPLIANCE_INVARIANT_MISSING";
const PLATFORM_COMPLIANCE_ROUTE = "GET /api/backoffice/platform-compliance";
const PLATFORM_COMPLIANCE_SCHEMA_VERSION = 1;
const PLATFORM_COMPLIANCE_SCOPE = "platform";

const REQUIRED_PLATFORM_PROTECTION_ROUTES = Object.freeze({
  auditLogsPlatformDenied: "GET /api/audit",
  schoolPrivacyRequestsPlatformDenied: "GET /api/privacy/erasure-requests",
  schoolPrivacyExecutionPlatformDenied: "POST /api/privacy/erasure-requests/:requestId/execute",
  schoolDataExportPlatformDenied: "GET /api/data-export",
  advancedReportsPlatformDenied: "GET /api/v2/reports/advanced",
});

/** Surfaces produit réellement présentes — ne sortent jamais dans le DTO client. */
const PLATFORM_COMPLIANCE_CAPABILITY_SURFACES = Object.freeze({
  privacyPolicy: "/confidentialite",
  accountDeletionPage: "/suppression-compte",
  erasureRequestIntake: "POST /api/privacy/erasure-requests",
  selfErasure: "POST /api/privacy/erasure-requests/self/execute",
  schoolDataExport: "GET /api/data-export",
});

const PLATFORM_COMPLIANCE_KEY_PATHS = Object.freeze([
  "schemaVersion",
  "scope",
  "generatedAt",
  "privacyRequests",
  "privacyRequests.total",
  "privacyRequests.pending",
  "privacyRequests.processed",
  "privacyRequests.rejected",
  "capabilities",
  "capabilities.privacyPolicy",
  "capabilities.privacyPolicy.configured",
  "capabilities.accountDeletionPage",
  "capabilities.accountDeletionPage.configured",
  "capabilities.erasureRequestIntake",
  "capabilities.erasureRequestIntake.configured",
  "capabilities.selfErasure",
  "capabilities.selfErasure.configured",
  "capabilities.schoolDataExport",
  "capabilities.schoolDataExport.configured",
  "protections",
  "protections.auditLogsPlatformDenied",
  "protections.schoolPrivacyRequestsPlatformDenied",
  "protections.schoolPrivacyExecutionPlatformDenied",
  "protections.schoolDataExportPlatformDenied",
  "protections.advancedReportsPlatformDenied",
]);

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function asCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function requirePlatformProtection(routeKey) {
  if (!SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(routeKey)) {
    throw createHttpError(
      500,
      `Invariant de protection plateforme manquant: ${routeKey}`,
      PLATFORM_COMPLIANCE_INVARIANT_MISSING,
    );
  }
  return true;
}

function assertPlatformComplianceRead(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw createHttpError(401, "Authentification requise.", "UNAUTHENTICATED");
  }
  if (!isSuperAdminPrincipal(principal)) {
    throw createHttpError(403, "Accès réservé au Superadmin.", PLATFORM_COMPLIANCE_DENIED);
  }
}

function configuredCapability() {
  return Object.freeze({ configured: true });
}

function buildPlatformComplianceDto(counts = {}, generatedAt = new Date().toISOString()) {
  return Object.freeze({
    schemaVersion: PLATFORM_COMPLIANCE_SCHEMA_VERSION,
    scope: PLATFORM_COMPLIANCE_SCOPE,
    generatedAt: String(generatedAt),
    privacyRequests: Object.freeze({
      total: asCount(counts.total),
      pending: asCount(counts.pending),
      processed: asCount(counts.processed),
      rejected: asCount(counts.rejected),
    }),
    capabilities: Object.freeze({
      privacyPolicy: configuredCapability(),
      accountDeletionPage: configuredCapability(),
      erasureRequestIntake: configuredCapability(),
      selfErasure: configuredCapability(),
      schoolDataExport: configuredCapability(),
    }),
    protections: Object.freeze({
      auditLogsPlatformDenied: requirePlatformProtection(
        REQUIRED_PLATFORM_PROTECTION_ROUTES.auditLogsPlatformDenied,
      ),
      schoolPrivacyRequestsPlatformDenied: requirePlatformProtection(
        REQUIRED_PLATFORM_PROTECTION_ROUTES.schoolPrivacyRequestsPlatformDenied,
      ),
      schoolPrivacyExecutionPlatformDenied: requirePlatformProtection(
        REQUIRED_PLATFORM_PROTECTION_ROUTES.schoolPrivacyExecutionPlatformDenied,
      ),
      schoolDataExportPlatformDenied: requirePlatformProtection(
        REQUIRED_PLATFORM_PROTECTION_ROUTES.schoolDataExportPlatformDenied,
      ),
      advancedReportsPlatformDenied: requirePlatformProtection(
        REQUIRED_PLATFORM_PROTECTION_ROUTES.advancedReportsPlatformDenied,
      ),
    }),
  });
}

function collectObjectKeyPaths(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...collectObjectKeyPaths(value[key], path)];
  });
}

async function getPlatformCompliance(repository, principal) {
  assertPlatformComplianceRead(principal);
  if (!repository || typeof repository.getPlatformPrivacyRequestCounts !== "function") {
    throw createHttpError(500, "Projection conformité plateforme indisponible.");
  }
  const counts = await repository.getPlatformPrivacyRequestCounts();
  return buildPlatformComplianceDto(counts);
}

module.exports = {
  PLATFORM_COMPLIANCE_DENIED,
  PLATFORM_COMPLIANCE_INVARIANT_MISSING,
  PLATFORM_COMPLIANCE_ROUTE,
  PLATFORM_COMPLIANCE_SCHEMA_VERSION,
  PLATFORM_COMPLIANCE_SCOPE,
  PLATFORM_COMPLIANCE_KEY_PATHS,
  PLATFORM_COMPLIANCE_CAPABILITY_SURFACES,
  REQUIRED_PLATFORM_PROTECTION_ROUTES,
  assertPlatformComplianceRead,
  buildPlatformComplianceDto,
  collectObjectKeyPaths,
  getPlatformCompliance,
};
