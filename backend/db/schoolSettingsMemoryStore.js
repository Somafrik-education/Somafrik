"use strict";

const { randomUUID } = require("node:crypto");
const { withSystemActivePeriods, defaultAcademicPeriods, inferPeriodMode } = require("../lib/academicConfigDefaults");
const {
  SCHOOL_SETTINGS_ERROR,
  asTrimmed,
  createSchoolSettingsError,
  inferPeriodType,
  mapSettingsRow,
  classifyLegacySchoolSettings,
  extractValidatedSchoolSettingsScalars,
  settingsPatchFromCaptured,
} = require("../lib/schoolSettingsManagement");

function createSchoolSettingsMemoryStore(seed = {}) {
  const schools = new Map();
  const settings = new Map();
  const years = new Map();
  const terms = [];
  const classNames = new Map();
  const subjectNames = new Map();
  const legacyPayloads = new Map();

  function rememberSchool(school) {
    const code = asTrimmed(school.loginCode ?? school.login_code).toUpperCase();
    if (!code) return null;
    const entry = {
      id: school.id ?? randomUUID(),
      school_code: code,
      login_code: code,
    };
    schools.set(code, entry);
    return entry;
  }

  for (const school of seed.schools ?? []) rememberSchool(school);
  if (seed.school) rememberSchool(seed.school);

  function schoolByCode(schoolCode) {
    return schools.get(asTrimmed(schoolCode).toUpperCase()) ?? null;
  }

  return {
    registerSchool(school) {
      return rememberSchool(school);
    },
    setLegacySchoolSettingsPayload(schoolCode, payload) {
      legacyPayloads.set(asTrimmed(schoolCode).toUpperCase(), payload);
    },
    setClassNames(schoolCode, names) {
      const school = schoolByCode(schoolCode);
      if (school) classNames.set(school.id, [...(names ?? [])]);
    },
    setSubjectNames(schoolCode, names) {
      const school = schoolByCode(schoolCode);
      if (school) subjectNames.set(school.id, [...(names ?? [])]);
    },
    async getSchoolByCode(schoolCode) {
      return schoolByCode(schoolCode);
    },
    async requireSchoolByCode(schoolCode) {
      const school = schoolByCode(schoolCode);
      if (!school) {
        throw createSchoolSettingsError(404, "Établissement introuvable.", SCHOOL_SETTINGS_ERROR.SCHOOL_NOT_FOUND);
      }
      return school;
    },
    async listClassNames(schoolId) {
      return [...(classNames.get(schoolId) ?? [])];
    },
    async listSubjectNames(schoolId) {
      return [...(subjectNames.get(schoolId) ?? [])];
    },
    async listTermRows(schoolId) {
      const year = years.get(schoolId);
      if (!year) return [];
      return terms.filter((row) => row.academic_year_id === year.id);
    },
    async getSettings(schoolId) {
      return settings.get(schoolId) ?? null;
    },
    async upsertSettings(schoolId, patch) {
      const current = settings.get(schoolId);
      const row = {
        school_id: schoolId,
        period_mode: patch.periodMode ?? current?.period_mode ?? "trimestre",
        default_scale: patch.defaultScale ?? Number(current?.default_scale ?? 20),
        report_card_mode: patch.reportCardMode ?? current?.report_card_mode ?? "period",
        created_at: current?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      settings.set(schoolId, row);
      return row;
    },
    async seedDefaultSettingsIfEmpty(schoolId, defaults = {}) {
      if (settings.has(schoolId)) return settings.get(schoolId);
      return this.upsertSettings(schoolId, defaults);
    },
    async ensureSettingsRow(schoolId) {
      const existing = await this.getSettings(schoolId);
      if (existing) return existing;
      const created = await this.seedDefaultSettingsIfEmpty(schoolId);
      if (!created) {
        throw createSchoolSettingsError(
          500,
          "Impossible de matérialiser school_settings.",
          SCHOOL_SETTINGS_ERROR.SCHOOL_SETTINGS_UNAVAILABLE,
          { schoolId },
        );
      }
      return created;
    },
    async seedDefaultTermsIfEmpty(schoolId) {
      let year = years.get(schoolId);
      if (!year) {
        year = { id: randomUUID(), school_id: schoolId, name: "2025-2026", is_current: true, status: "open" };
        years.set(schoolId, year);
      }
      const existing = terms.filter((row) => row.academic_year_id === year.id);
      if (existing.length) return existing;
      for (const period of defaultAcademicPeriods()) {
        terms.push({
          id: randomUUID(),
          academic_year_id: year.id,
          name: period.name,
          start_date: period.startDate,
          end_date: period.endDate,
          status: "open",
        });
      }
      return terms.filter((row) => row.academic_year_id === year.id);
    },
    async replaceTerms(schoolId, periods) {
      let year = years.get(schoolId);
      if (!year) {
        throw createSchoolSettingsError(
          400,
          "Aucune année scolaire ouverte. Créez une année avant les périodes.",
          SCHOOL_SETTINGS_ERROR.ACADEMIC_YEAR_REQUIRED,
        );
      }
      const incoming = Array.isArray(periods) ? periods : [];
      const names = incoming.map((item) => asTrimmed(item?.name)).filter(Boolean);
      if (!names.length) {
        throw createSchoolSettingsError(400, "Au moins une période est obligatoire.", SCHOOL_SETTINGS_ERROR.PERIODS_REQUIRED);
      }
      const unique = new Set(names.map((name) => name.toLowerCase()));
      if (unique.size !== names.length) {
        throw createSchoolSettingsError(400, "Les noms de périodes doivent être uniques.", SCHOOL_SETTINGS_ERROR.PERIODS_REQUIRED);
      }
      for (let index = terms.length - 1; index >= 0; index -= 1) {
        if (terms[index].academic_year_id === year.id) terms.splice(index, 1);
      }
      const saved = [];
      for (const period of incoming) {
        const row = {
          id: period.id && String(period.id).length ? period.id : randomUUID(),
          academic_year_id: year.id,
          name: asTrimmed(period.name),
          start_date: period.startDate ?? period.start_date ?? null,
          end_date: period.endDate ?? period.end_date ?? null,
          status: "open",
        };
        terms.push(row);
        saved.push(row);
      }
      return saved;
    },
    async projectAcademicConfig(schoolCode) {
      const school = await this.requireSchoolByCode(schoolCode);
      const settingsRow = await this.ensureSettingsRow(school.id);
      const mapped = mapSettingsRow(settingsRow, school.school_code);
      const termRows = await this.listTermRows(school.id);
      const periods = withSystemActivePeriods({
        periods: termRows.map((row, index) => ({
          id: row.id,
          name: row.name,
          type: inferPeriodType(row.name),
          order: index + 1,
          startDate: row.start_date ?? "",
          endDate: row.end_date ?? "",
          active: false,
        })),
      }).periods;
      return {
        schoolCode: school.school_code,
        schoolYear: years.get(school.id)?.name ?? "",
        periodMode: mapped.periodMode || inferPeriodMode(periods),
        periods,
        evaluationTypes: [],
        defaultScale: mapped.defaultScale,
        reportCardMode: mapped.reportCardMode,
        levels: [],
        tracks: [],
        userRoles: [],
        classNames: await this.listClassNames(school.id),
        subjects: await this.listSubjectNames(school.id),
      };
    },
    async inventoryLegacySchoolSettingsPayloads() {
      const inventory = [];
      const ambiguous = [];
      const captured = [];
      for (const [schoolCode, payload] of legacyPayloads.entries()) {
        const school = schoolByCode(schoolCode);
        const classified = classifyLegacySchoolSettings(payload, {
          termNames: school ? (await this.listTermRows(school.id)).map((row) => row.name) : [],
          classNames: school ? await this.listClassNames(school.id) : [],
          subjectNames: school ? await this.listSubjectNames(school.id) : [],
        });
        inventory.push({ schoolCode, issues: classified.issues });
        if (classified.ambiguous) {
          ambiguous.push({ schoolCode, issues: classified.issues, keys: classified.issues.map((item) => item.key) });
        } else if (school) {
          captured.push({
            schoolId: school.id,
            schoolCode,
            ...extractValidatedSchoolSettingsScalars(payload),
          });
        }
      }
      return { inventory, ambiguous, captured };
    },
    async bootstrapCanonicalSettingsForAllSchools(captured = []) {
      const capturedBySchoolId = new Map((captured ?? []).map((item) => [item.schoolId, item]));
      for (const school of schools.values()) {
        const patch = settingsPatchFromCaptured(capturedBySchoolId.get(school.id));
        if (Object.keys(patch).length > 0) {
          await this.upsertSettings(school.id, patch);
        } else {
          await this.seedDefaultSettingsIfEmpty(school.id);
        }
        await this.seedDefaultTermsIfEmpty(school.id);
      }
    },
  };
}

module.exports = {
  createSchoolSettingsMemoryStore,
};
