"use strict";

const { getCountryCodeFromScope } = require("./countryScope");

const EDUCATION_REFERENCE_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  COUNTRY_NOT_FOUND: "COUNTRY_NOT_FOUND",
  SCHOOL_NOT_FOUND: "SCHOOL_NOT_FOUND",
  LEVEL_NOT_FOUND: "LEVEL_NOT_FOUND",
  STREAM_NOT_FOUND: "STREAM_NOT_FOUND",
  COUNTRY_MISMATCH: "COUNTRY_MISMATCH",
  LEVEL_IN_USE: "LEVEL_IN_USE",
  LEVEL_HAS_ACTIVE_STREAMS: "LEVEL_HAS_ACTIVE_STREAMS",
  STREAM_IN_USE: "STREAM_IN_USE",
  LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN: "LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN",
  LEGACY_ACADEMIC_STREAMS_WRITE_FORBIDDEN: "LEGACY_ACADEMIC_STREAMS_WRITE_FORBIDDEN",
  LEGACY_ACADEMIC_REFERENCE_AMBIGUOUS: "LEGACY_ACADEMIC_REFERENCE_AMBIGUOUS",
});

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);
const STREAM_TYPES = new Set(["filiere", "serie", "option"]);

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

function createEducationReferenceError(status, message, code, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code || EDUCATION_REFERENCE_ERROR.FORBIDDEN;
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

function educationReferenceAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

function assertSuperAdmin(principal) {
  if (!isSuperAdminPrincipal(principal)) {
    throw createEducationReferenceError(
      403,
      "Seul le Super Administrateur peut gérer le référentiel pédagogique.",
      EDUCATION_REFERENCE_ERROR.FORBIDDEN,
    );
  }
}

function resolvePrincipalCountryCode(principal) {
  return asTrimmed(principal?.countryCode) || getCountryCodeFromScope(principal?.countryScope);
}

function assertEducationReferenceCountryRead(principal, countryCode) {
  if (isSuperAdminPrincipal(principal)) return;
  if (isCountryAdminPrincipal(principal)) {
    const requested = asTrimmed(countryCode).toUpperCase();
    const principalCountry = resolvePrincipalCountryCode(principal).toUpperCase();
    if (!requested || !principalCountry || requested !== principalCountry) {
      throw createEducationReferenceError(
        403,
        "Accès refusé : pays hors périmètre.",
        EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH,
      );
    }
    return;
  }
}

function assertSchoolCatalogRead(principal) {
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    return;
  }
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  const allowed = [
    "Paramètres Établissement:READ",
    "Paramètres Établissement:UPDATE",
    "Gérer classes",
    "Gérer planning académique",
    "ALL_PRIVILEGES",
    "COUNTRY_PRIVILEGES",
    "Référentiels pédagogiques:READ",
  ];
  if (!allowed.some((key) => permissions.includes(key))) {
    throw createEducationReferenceError(403, "Accès refusé au référentiel pédagogique.", EDUCATION_REFERENCE_ERROR.FORBIDDEN);
  }
}

function assertSchoolActivationWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  const allowed = [
    "Paramètres Établissement:UPDATE",
    "ALL_PRIVILEGES",
    "Référentiels pédagogiques:UPDATE",
  ];
  if (!allowed.some((key) => permissions.includes(key))) {
    throw createEducationReferenceError(
      403,
      "Vous n'avez pas le droit de modifier l'activation pédagogique de l'établissement.",
      EDUCATION_REFERENCE_ERROR.FORBIDDEN,
    );
  }
}

function mapLevelRow(row, countryCode) {
  return {
    id: row.id,
    countryId: row.country_id,
    countryCode: countryCode ?? row.country_code ?? "",
    code: row.level_code,
    name: row.name,
    displayOrder: Number(row.display_order ?? 0),
    status: row.status === "archived" ? "archived" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStreamRow(row, countryCode) {
  return {
    id: row.id,
    countryId: row.country_id,
    countryCode: countryCode ?? row.country_code ?? "",
    levelId: row.level_id ?? null,
    code: row.stream_code,
    name: row.name,
    streamType: row.stream_type,
    displayOrder: Number(row.display_order ?? 0),
    status: row.status === "archived" ? "archived" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasLegacyAcademicLevelsKey(payload) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "levels");
}

function hasLegacyAcademicStreamsKey(payload) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "tracks");
}

function assertNoLegacyAcademicLevelsTracksWrite(payload) {
  if (!payload || typeof payload !== "object") return;
  if (hasLegacyAcademicLevelsKey(payload)) {
    throw createEducationReferenceError(
      400,
      "La clé levels n'est plus modifiable via academic-config. Utilisez le référentiel pédagogique canonique.",
      EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN,
    );
  }
  if (hasLegacyAcademicStreamsKey(payload)) {
    throw createEducationReferenceError(
      400,
      "La clé tracks n'est plus modifiable via academic-config. Utilisez le référentiel pédagogique canonique.",
      EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_STREAMS_WRITE_FORBIDDEN,
    );
  }
}

function stripLegacyAcademicLevelsTracks(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  delete next.levels;
  delete next.tracks;
  return next;
}

module.exports = {
  EDUCATION_REFERENCE_ERROR,
  STREAM_TYPES,
  asTrimmed,
  normalizeCode,
  createEducationReferenceError,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  ignoreClientScope,
  educationReferenceAuditMetaFromRequest,
  assertSuperAdmin,
  assertEducationReferenceCountryRead,
  resolvePrincipalCountryCode,
  assertSchoolCatalogRead,
  assertSchoolActivationWrite,
  mapLevelRow,
  mapStreamRow,
  hasLegacyAcademicLevelsKey,
  hasLegacyAcademicStreamsKey,
  assertNoLegacyAcademicLevelsTracksWrite,
  stripLegacyAcademicLevelsTracks,
};
