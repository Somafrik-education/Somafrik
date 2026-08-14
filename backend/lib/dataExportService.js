"use strict";

const { TenantScopeService } = require("../services/tenantScopeService");
const {
  DATA_EXPORT_ERROR,
  assertDataExportRead,
  resolveExportSchoolCode,
  buildExportEnvelope,
  isSuperAdminPrincipal,
} = require("./dataExportManagement");
const { BusinessError } = require("../services/authService");

const tenantScopeService = new TenantScopeService();

function createExportError(status, message, code) {
  const error = new BusinessError(status, message);
  error.code = code;
  return error;
}

async function safeDomain(loader) {
  try {
    return await loader();
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw error;
  }
}

async function exportSchoolData(repo, principal, requestedSchoolCode, auditMeta = {}) {
  assertDataExportRead(principal);
  const schoolCode = resolveExportSchoolCode(principal, requestedSchoolCode);
  tenantScopeService.assertSchoolAccess(principal, schoolCode);

  const resolveSchool =
    typeof repo.getSchoolByCode === "function"
      ? (code) => repo.getSchoolByCode(code)
      : typeof repo.getPlatformSchoolByCode === "function"
        ? (code) => repo.getPlatformSchoolByCode(code)
        : null;
  if (resolveSchool) {
    const school = await resolveSchool(schoolCode);
    if (!school) {
      throw createExportError(404, "Établissement introuvable.", DATA_EXPORT_ERROR.SCHOOL_NOT_FOUND);
    }
  }

  const domains = {};

  if (typeof repo.getSchoolSettings === "function") {
    domains.schoolSettings = await safeDomain(() => repo.getSchoolSettings(principal, schoolCode));
  }
  if (typeof repo.listSchoolStudents === "function") {
    domains.students = await safeDomain(() => repo.listSchoolStudents(schoolCode));
  }
  if (typeof repo.listSchoolClasses === "function") {
    domains.classes = await safeDomain(() => repo.listSchoolClasses(schoolCode));
  }
  if (typeof repo.listSchoolTeachers === "function") {
    domains.teachers = await safeDomain(() => repo.listSchoolTeachers(schoolCode));
  }
  if (isSuperAdminPrincipal(principal) && typeof repo.getAuditLogs === "function") {
    const rows = await repo.getAuditLogs({ schoolCode, limit: 200 });
    domains.audit = (rows ?? []).map((row) => ({
      action: row.action,
      entityType: row.entityType ?? row.entity_type,
      createdAt: row.createdAt ?? row.created_at,
      userCode: row.userCode ?? row.user_code ?? null,
    }));
  }

  const generatedAt = new Date().toISOString();
  const envelope = buildExportEnvelope({ schoolCode, domains, generatedAt });

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
      generatedAt,
    },
    ipAddress: auditMeta.ipAddress,
    userAgent: auditMeta.userAgent,
  });

  return envelope;
}

module.exports = { exportSchoolData };
