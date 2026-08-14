"use strict";

const { TenantScopeService } = require("../services/tenantScopeService");
const {
  assertDataExportRead,
  resolveExportSchoolCode,
  buildExportEnvelope,
  isSuperAdminPrincipal,
} = require("./dataExportManagement");
const { loadExportDomains } = require("./dataExportSnapshot");
const { BusinessError } = require("../services/authService");

const tenantScopeService = new TenantScopeService();

function createExportError(status, message, code) {
  const error = new BusinessError(status, message);
  error.code = code;
  return error;
}

async function runExportSnapshot(repo, load) {
  if (typeof repo.withReadOnlyRepeatableRead === "function") {
    return repo.withReadOnlyRepeatableRead(async (scoped) => load(scoped));
  }
  if (typeof repo.withTransaction === "function") {
    return repo.withTransaction(async (tx) => {
      const scoped = typeof repo.createTxScope === "function" && tx ? repo.createTxScope(tx) : repo;
      return load(scoped);
    });
  }
  return load(repo);
}

async function exportSchoolData(repo, principal, requestedSchoolCode, auditMeta = {}, snapshotOptions = {}) {
  assertDataExportRead(principal);
  const schoolCode = resolveExportSchoolCode(principal, requestedSchoolCode);
  tenantScopeService.assertSchoolAccess(principal, schoolCode);

  const envelope = await runExportSnapshot(repo, async (scoped) => {
    const snapshot = await loadExportDomains(scoped, {
      schoolCode,
      principal,
      includeAudit: isSuperAdminPrincipal(principal),
      onBarrier: snapshotOptions.onBarrier,
    });
    return buildExportEnvelope({
      schoolCode,
      domains: snapshot.domains,
      generatedAt: new Date().toISOString(),
    });
  });

  if (typeof repo.recordAudit !== "function") {
    throw createExportError(500, "Audit indisponible pour l'export.", "AUDIT_UNAVAILABLE");
  }
  await repo.recordAudit({
    schoolCode,
    userId: principal?.sub || principal?.id,
    action: "export_school_data",
    entityType: "school_export",
    entityId: schoolCode,
    newValue: {
      includedDomains: envelope.includedDomains,
      generatedAt: envelope.generatedAt,
    },
    ipAddress: auditMeta.ipAddress,
    userAgent: auditMeta.userAgent,
  });

  return envelope;
}

module.exports = { exportSchoolData };
