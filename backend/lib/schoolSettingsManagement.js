"use strict";

const seedData = require("../data");

const SCHOOL_SETTINGS_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  SCHOOL_NOT_FOUND: "SCHOOL_NOT_FOUND",
  ACADEMIC_YEAR_REQUIRED: "ACADEMIC_YEAR_REQUIRED",
  TERM_IN_USE: "TERM_IN_USE",
  PERIODS_REQUIRED: "PERIODS_REQUIRED",
  INVALID_SCALE: "INVALID_SCALE",
  INVALID_PERIOD_MODE: "INVALID_PERIOD_MODE",
  INVALID_REPORT_CARD_MODE: "INVALID_REPORT_CARD_MODE",
  LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN: "LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN",
  LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN: "LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN",
  LEGACY_SCHOOL_CLASS_NAMES_WRITE_FORBIDDEN: "LEGACY_SCHOOL_CLASS_NAMES_WRITE_FORBIDDEN",
  LEGACY_SCHOOL_SUBJECTS_WRITE_FORBIDDEN: "LEGACY_SCHOOL_SUBJECTS_WRITE_FORBIDDEN",
  LEGACY_SCHOOL_SETTINGS_AMBIGUOUS: "LEGACY_SCHOOL_SETTINGS_AMBIGUOUS",
  LEGACY_SCHOOL_PERIODS_AMBIGUOUS: "LEGACY_SCHOOL_PERIODS_AMBIGUOUS",
  LEGACY_SCHOOL_CLASS_NAMES_AMBIGUOUS: "LEGACY_SCHOOL_CLASS_NAMES_AMBIGUOUS",
  LEGACY_SCHOOL_SUBJECTS_AMBIGUOUS: "LEGACY_SCHOOL_SUBJECTS_AMBIGUOUS",
});

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

const PERIOD_MODES = Object.freeze(["trimestre", "semestre", "periode"]);
const REPORT_CARD_MODES = Object.freeze(["period", "annual", "custom"]);

const DEFAULT_TRIMESTRE_NAMES = Object.freeze(["Trimestre 1", "Trimestre 2", "Trimestre 3"]);
const DEFAULT_SEMESTRE_NAMES = Object.freeze(["Semestre 1", "Semestre 2"]);

const LEGACY_PERIOD_KEYS = Object.freeze(["periods", "periodMode"]);
const LEGACY_CLASS_NAME_KEYS = Object.freeze(["classNames"]);
const LEGACY_SUBJECT_KEYS = Object.freeze(["subjects", "subjectsByClass"]);
const LEGACY_SETTING_KEYS = Object.freeze([
  "defaultScale",
  "reportCardMode",
  "allowCustomClasses",
  "allowCustomCourses",
  "allowCustomReportCards",
  "bulletinDesignByClass",
  "schoolYear",
  "academicYear",
  "defaultGradeScale",
]);

const ALL_LEGACY_SCHOOL_SETTINGS_KEYS = Object.freeze([
  ...LEGACY_PERIOD_KEYS,
  ...LEGACY_CLASS_NAME_KEYS,
  ...LEGACY_SUBJECT_KEYS,
  ...LEGACY_SETTING_KEYS,
]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeLabel(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function createSchoolSettingsError(status, message, code, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code || SCHOOL_SETTINGS_ERROR.FORBIDDEN;
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
  delete next.tenantId;
  return next;
}

function schoolSettingsAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

function principalHasAnyPermission(principal, allowed) {
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  return allowed.some((key) => permissions.includes(key));
}

function assertSchoolSettingsRead(principal) {
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) return;
  const allowed = [
    "Paramètres Établissement:READ",
    "Paramètres Établissement:UPDATE",
    "Gérer planning académique",
    "Gérer classes",
    "ALL_PRIVILEGES",
    "COUNTRY_PRIVILEGES",
  ];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createSchoolSettingsError(403, "Accès refusé aux paramètres d'établissement.", SCHOOL_SETTINGS_ERROR.FORBIDDEN);
  }
}

function assertSchoolSettingsWrite(principal) {
  if (isSuperAdminPrincipal(principal)) return;
  const allowed = [
    "Paramètres Établissement:UPDATE",
    "Gérer planning académique",
    "ALL_PRIVILEGES",
  ];
  if (!principalHasAnyPermission(principal, allowed)) {
    throw createSchoolSettingsError(
      403,
      "Vous n'avez pas le droit de modifier les paramètres d'établissement.",
      SCHOOL_SETTINGS_ERROR.FORBIDDEN,
    );
  }
}

function hasOwn(payload, key) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, key);
}

function sameNameSet(left, right) {
  const a = (left ?? []).map(normalizeLabel).filter(Boolean);
  const b = (right ?? []).map(normalizeLabel).filter(Boolean);
  if (a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length) return false;
  return b.every((item) => set.has(item));
}

function extractStringList(value) {
  if (!Array.isArray(value)) return value == null ? [] : [asTrimmed(value)].filter(Boolean);
  return value.map((item) => asTrimmed(item)).filter(Boolean);
}

function extractPeriodNames(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === "object" ? asTrimmed(item.name) : asTrimmed(item)))
    .filter(Boolean);
}

function isEmptyLegacyCollection(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isValidPeriodMode(value) {
  return PERIOD_MODES.includes(asTrimmed(value));
}

function isValidReportCardMode(value) {
  return REPORT_CARD_MODES.includes(asTrimmed(value));
}

function isValidDefaultScale(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100;
}

function inferPeriodType(name) {
  const label = normalizeLabel(name);
  if (label.includes("semestre")) return "Semestre";
  if (label.includes("trimestre")) return "Trimestre";
  return "Période";
}

function mapSettingsRow(row, schoolCode) {
  return {
    schoolId: row.school_id,
    schoolCode: schoolCode ?? row.school_code ?? "",
    periodMode: PERIOD_MODES.includes(row.period_mode) ? row.period_mode : "trimestre",
    defaultScale: Number(row.default_scale ?? 20),
    reportCardMode: REPORT_CARD_MODES.includes(row.report_card_mode) ? row.report_card_mode : "period",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function classifyLegacySchoolSettings(payload, context = {}) {
  const issues = [];
  if (!payload || typeof payload !== "object") {
    return { ambiguous: false, issues };
  }

  if (hasOwn(payload, "periods")) {
    if (payload.periods != null && !Array.isArray(payload.periods)) {
      issues.push({ key: "periods", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_AMBIGUOUS });
    } else {
      const names = extractPeriodNames(payload.periods);
      const termNames = context.termNames ?? [];
      if (names.length) {
        const matchesTerms = termNames.length > 0 && sameNameSet(names, termNames);
        const matchesDefaultEmptyTerms =
          termNames.length === 0 &&
          (sameNameSet(names, DEFAULT_TRIMESTRE_NAMES) || sameNameSet(names, DEFAULT_SEMESTRE_NAMES));
        if (!matchesTerms && !matchesDefaultEmptyTerms) {
          issues.push({ key: "periods", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_AMBIGUOUS });
        }
      }
    }
  }

  if (hasOwn(payload, "periodMode") && payload.periodMode != null && !isValidPeriodMode(payload.periodMode)) {
    issues.push({ key: "periodMode", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS });
  }

  if (hasOwn(payload, "defaultScale") && payload.defaultScale != null && !isValidDefaultScale(payload.defaultScale)) {
    issues.push({ key: "defaultScale", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS });
  }

  if (hasOwn(payload, "defaultGradeScale") && payload.defaultGradeScale != null) {
    if (!isValidDefaultScale(payload.defaultGradeScale)) {
      issues.push({ key: "defaultGradeScale", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS });
    } else if (
      hasOwn(payload, "defaultScale") &&
      payload.defaultScale != null &&
      Number(payload.defaultScale) !== Number(payload.defaultGradeScale)
    ) {
      issues.push({ key: "defaultGradeScale", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS });
    }
  }

  if (
    hasOwn(payload, "reportCardMode") &&
    payload.reportCardMode != null &&
    !isValidReportCardMode(payload.reportCardMode)
  ) {
    issues.push({ key: "reportCardMode", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS });
  }

  if (hasOwn(payload, "classNames") && !isEmptyLegacyCollection(payload.classNames)) {
    const names = extractStringList(payload.classNames);
    const dbNames = context.classNames ?? [];
    const matchesDb = dbNames.length > 0 && sameNameSet(names, dbNames);
    const matchesDemoEmptyDb = dbNames.length === 0 && sameNameSet(names, seedData.demoClassNames ?? []);
    if (!matchesDb && !matchesDemoEmptyDb) {
      issues.push({ key: "classNames", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_CLASS_NAMES_AMBIGUOUS });
    }
  }

  if (hasOwn(payload, "subjects") && !isEmptyLegacyCollection(payload.subjects)) {
    const names = extractStringList(payload.subjects);
    const dbNames = context.subjectNames ?? [];
    const matchesDb = dbNames.length > 0 && sameNameSet(names, dbNames);
    const matchesDemoEmptyDb = dbNames.length === 0 && sameNameSet(names, seedData.demoSubjects ?? []);
    if (!matchesDb && !matchesDemoEmptyDb) {
      issues.push({ key: "subjects", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SUBJECTS_AMBIGUOUS });
    }
  }

  if (hasOwn(payload, "subjectsByClass") && payload.subjectsByClass && typeof payload.subjectsByClass === "object") {
    const values = Object.values(payload.subjectsByClass);
    const hasContent = values.some((list) => Array.isArray(list) && list.some((item) => asTrimmed(item)));
    if (hasContent) {
      issues.push({ key: "subjectsByClass", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SUBJECTS_AMBIGUOUS });
    }
  }

  if (
    hasOwn(payload, "bulletinDesignByClass") &&
    payload.bulletinDesignByClass &&
    typeof payload.bulletinDesignByClass === "object" &&
    Object.keys(payload.bulletinDesignByClass).length > 0
  ) {
    issues.push({ key: "bulletinDesignByClass", code: SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS });
  }

  return { ambiguous: issues.length > 0, issues };
}

function isLegacySchoolSettingsAmbiguous(payload, context = {}) {
  return classifyLegacySchoolSettings(payload, context).ambiguous;
}

function firstPresentKey(payload, keys) {
  if (!payload || typeof payload !== "object") return null;
  return keys.find((key) => hasOwn(payload, key)) ?? null;
}

function assertNoLegacySchoolSettingsWrite(payload) {
  if (!payload || typeof payload !== "object") return;
  const periodKey = firstPresentKey(payload, LEGACY_PERIOD_KEYS);
  if (periodKey) {
    throw createSchoolSettingsError(
      400,
      "Les périodes académiques ne sont plus modifiables via academic-config. Utilisez /api/academic-periods et /api/school-settings.",
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN,
      { key: periodKey },
    );
  }
  const classKey = firstPresentKey(payload, LEGACY_CLASS_NAME_KEYS);
  if (classKey) {
    throw createSchoolSettingsError(
      400,
      "La clé classNames n'est plus modifiable via academic-config. Utilisez le référentiel PostgreSQL /api/classes.",
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_CLASS_NAMES_WRITE_FORBIDDEN,
      { key: classKey },
    );
  }
  const subjectKey = firstPresentKey(payload, LEGACY_SUBJECT_KEYS);
  if (subjectKey) {
    throw createSchoolSettingsError(
      400,
      "Les matières ne sont plus modifiables via academic-config. Utilisez le référentiel PostgreSQL /api/v2/subjects.",
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SUBJECTS_WRITE_FORBIDDEN,
      { key: subjectKey },
    );
  }
  const settingKey = firstPresentKey(payload, LEGACY_SETTING_KEYS);
  if (settingKey) {
    throw createSchoolSettingsError(
      400,
      "Ces paramètres d'établissement ne sont plus modifiables via academic-config. Utilisez /api/school-settings.",
      SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN,
      { key: settingKey },
    );
  }
}

function stripLegacySchoolSettings(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  for (const key of ALL_LEGACY_SCHOOL_SETTINGS_KEYS) {
    delete next[key];
  }
  return next;
}

function parseSettingsPatch(payload) {
  const patch = ignoreClientScope(payload);
  const next = {};
  if (hasOwn(patch, "periodMode")) {
    if (!isValidPeriodMode(patch.periodMode)) {
      throw createSchoolSettingsError(
        400,
        "Mode de période invalide (trimestre, semestre ou periode).",
        SCHOOL_SETTINGS_ERROR.INVALID_PERIOD_MODE,
      );
    }
    next.periodMode = asTrimmed(patch.periodMode);
  }
  if (hasOwn(patch, "defaultScale")) {
    if (!isValidDefaultScale(patch.defaultScale)) {
      throw createSchoolSettingsError(
        400,
        "Barème par défaut invalide (nombre strictement positif, max 100).",
        SCHOOL_SETTINGS_ERROR.INVALID_SCALE,
      );
    }
    next.defaultScale = Number(patch.defaultScale);
  }
  if (hasOwn(patch, "reportCardMode")) {
    if (!isValidReportCardMode(patch.reportCardMode)) {
      throw createSchoolSettingsError(
        400,
        "Mode bulletin invalide (period, annual ou custom).",
        SCHOOL_SETTINGS_ERROR.INVALID_REPORT_CARD_MODE,
      );
    }
    next.reportCardMode = asTrimmed(patch.reportCardMode);
  }
  return next;
}

module.exports = {
  SCHOOL_SETTINGS_ERROR,
  PERIOD_MODES,
  REPORT_CARD_MODES,
  DEFAULT_TRIMESTRE_NAMES,
  DEFAULT_SEMESTRE_NAMES,
  ALL_LEGACY_SCHOOL_SETTINGS_KEYS,
  asTrimmed,
  normalizeLabel,
  createSchoolSettingsError,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  ignoreClientScope,
  schoolSettingsAuditMetaFromRequest,
  assertSchoolSettingsRead,
  assertSchoolSettingsWrite,
  hasOwn,
  sameNameSet,
  extractStringList,
  extractPeriodNames,
  inferPeriodType,
  mapSettingsRow,
  classifyLegacySchoolSettings,
  isLegacySchoolSettingsAmbiguous,
  assertNoLegacySchoolSettingsWrite,
  stripLegacySchoolSettings,
  parseSettingsPatch,
  isValidPeriodMode,
  isValidReportCardMode,
  isValidDefaultScale,
};
