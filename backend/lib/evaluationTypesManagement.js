"use strict";

const EVALUATION_TYPES_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  TYPE_NOT_FOUND: "TYPE_NOT_FOUND",
  TYPE_ARCHIVED: "TYPE_ARCHIVED",
  SCHOOL_NOT_FOUND: "SCHOOL_NOT_FOUND",
  LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN: "LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN",
  LEGACY_EVALUATION_TYPES_AMBIGUOUS: "LEGACY_EVALUATION_TYPES_AMBIGUOUS",
});

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

const DEFAULT_EVALUATION_TYPES = Object.freeze([
  { code: "interrogation", name: "Interrogation", displayOrder: 10 },
  { code: "devoir", name: "Devoir", displayOrder: 20 },
  { code: "composition", name: "Composition", displayOrder: 30 },
  { code: "examen", name: "Examen", displayOrder: 40 },
  { code: "tp", name: "Travail pratique", displayOrder: 50 },
  { code: "projet", name: "Projet", displayOrder: 60 },
  { code: "rattrapage", name: "Rattrapage", displayOrder: 70 },
  { code: "controle_continu", name: "Contrôle continu", displayOrder: 80 },
]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeCode(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeTypeLabel(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const DEFAULT_TYPE_KEYS = new Set(
  DEFAULT_EVALUATION_TYPES.flatMap((row) => [normalizeCode(row.code), normalizeTypeLabel(row.name)]),
);

function createEvaluationTypesError(status, message, code, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code || EVALUATION_TYPES_ERROR.FORBIDDEN;
  if (details) error.details = details;
  return error;
}

function isSuperAdminPrincipal(principal) {
  return SUPER_ADMIN_ROLES.has(asTrimmed(principal?.role));
}

function isCountryAdminPrincipal(principal) {
  return asTrimmed(principal?.role) === "Admin Pays";
}

function ignoreClientScope(payload = {}) {
  const next = { ...(payload && typeof payload === "object" ? payload : {}) };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.countryCode;
  delete next.country;
  delete next.countryId;
  return next;
}

function evaluationTypesAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

function principalHasAnyPermission(principal, allowed) {
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  return allowed.some((key) => permissions.includes(key));
}

function assertEvaluationTypesRead(principal) {
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) return;
  const allowed = [
    "Paramètres Établissement:READ",
    "Paramètres Établissement:UPDATE",
    "Gérer planning académique",
    "Gérer classes",
    "Notes:READ",
    "Notes:CREATE",
    "Notes:UPDATE",
    "Modifier notes",
    "Voir notes",
    "ALL_PRIVILEGES",
    "COUNTRY_PRIVILEGES",
  ];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createEvaluationTypesError(403, "Accès refusé au catalogue des types d'évaluation.", EVALUATION_TYPES_ERROR.FORBIDDEN);
  }
}

function assertEvaluationTypesWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = [
    "Paramètres Établissement:UPDATE",
    "Gérer planning académique",
    "ALL_PRIVILEGES",
  ];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createEvaluationTypesError(
      403,
      "Vous n'avez pas le droit de modifier les types d'évaluation.",
      EVALUATION_TYPES_ERROR.FORBIDDEN,
    );
  }
}

function mapEvaluationTypeRow(row, schoolCode) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: schoolCode ?? row.school_code ?? "",
    code: row.code,
    name: row.name,
    displayOrder: Number(row.display_order ?? 0),
    status: row.status === "archived" ? "archived" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasLegacyEvaluationTypesKey(payload) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "evaluationTypes");
}

function assertNoLegacyEvaluationTypesWrite(payload) {
  if (!payload || typeof payload !== "object") return;
  if (hasLegacyEvaluationTypesKey(payload)) {
    throw createEvaluationTypesError(
      400,
      "La clé evaluationTypes n'est plus modifiable via academic-config. Utilisez le catalogue PostgreSQL /api/evaluation-types.",
      EVALUATION_TYPES_ERROR.LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN,
    );
  }
}

function stripLegacyEvaluationTypes(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  delete next.evaluationTypes;
  return next;
}

function isTriviallyEquivalentLegacyType(value) {
  const label = asTrimmed(value);
  if (!label) return true;
  const code = normalizeCode(label);
  const name = normalizeTypeLabel(label);
  return DEFAULT_TYPE_KEYS.has(code) || DEFAULT_TYPE_KEYS.has(name);
}

function extractLegacyEvaluationTypeLabels(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (!Object.prototype.hasOwnProperty.call(payload, "evaluationTypes")) return [];
  if (!Array.isArray(payload.evaluationTypes)) {
    return payload.evaluationTypes == null ? [] : [payload.evaluationTypes];
  }
  return payload.evaluationTypes.map((item) => asTrimmed(item)).filter(Boolean);
}

function isLegacyEvaluationTypesAmbiguous(payload) {
  const labels = extractLegacyEvaluationTypeLabels(payload);
  if (!labels.length) return false;
  return labels.some((label) => !isTriviallyEquivalentLegacyType(label));
}

module.exports = {
  EVALUATION_TYPES_ERROR,
  DEFAULT_EVALUATION_TYPES,
  asTrimmed,
  normalizeCode,
  normalizeTypeLabel,
  createEvaluationTypesError,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  ignoreClientScope,
  evaluationTypesAuditMetaFromRequest,
  assertEvaluationTypesRead,
  assertEvaluationTypesWrite,
  mapEvaluationTypeRow,
  hasLegacyEvaluationTypesKey,
  assertNoLegacyEvaluationTypesWrite,
  stripLegacyEvaluationTypes,
  isTriviallyEquivalentLegacyType,
  extractLegacyEvaluationTypeLabels,
  isLegacyEvaluationTypesAmbiguous,
};
