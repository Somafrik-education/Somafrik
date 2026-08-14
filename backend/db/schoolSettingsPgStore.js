"use strict";

const { parsePeriodDate } = require("../lib/academicPeriods");
const { withSystemActivePeriods, defaultAcademicPeriods, inferPeriodMode } = require("../lib/academicConfigDefaults");
const {
  SCHOOL_SETTINGS_ERROR,
  DEFAULT_TRIMESTRE_NAMES,
  asTrimmed,
  createSchoolSettingsError,
  inferPeriodType,
  mapSettingsRow,
  classifyLegacySchoolSettings,
  isValidPeriodMode,
  isValidReportCardMode,
  isValidDefaultScale,
} = require("../lib/schoolSettingsManagement");

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  const parsed = parsePeriodDate(value);
  if (!parsed) return null;
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDisplayDate(value, formatDate) {
  if (typeof formatDate === "function") return formatDate(value) || "";
  return toIsoDate(value) || "";
}

function createSchoolSettingsPgStore(repo) {
  const one = (...args) => repo.one(...args);
  const all = (...args) => repo.all(...args);
  const query = (...args) => repo.query(...args);

  async function getSchoolByCode(schoolCode) {
    return one(
      `SELECT s.id, s.school_code, s.country_id
       FROM schools s
       WHERE upper(s.school_code) = upper($1)`,
      [asTrimmed(schoolCode).toUpperCase()],
    );
  }

  async function requireSchoolByCode(schoolCode) {
    const school = await getSchoolByCode(schoolCode);
    if (!school) {
      throw createSchoolSettingsError(404, "Établissement introuvable.", SCHOOL_SETTINGS_ERROR.SCHOOL_NOT_FOUND);
    }
    return school;
  }

  async function listClassNames(schoolId) {
    const rows = await all(
      `SELECT name FROM classes WHERE school_id = $1 AND status = 'active' ORDER BY name`,
      [schoolId],
    );
    return rows.map((row) => row.name);
  }

  async function listSubjectNames(schoolId) {
    const rows = await all(
      `SELECT name FROM subjects WHERE school_id = $1 AND status = 'active' ORDER BY name`,
      [schoolId],
    );
    return rows.map((row) => row.name);
  }

  async function findCurrentAcademicYear(schoolId) {
    return one(
      `SELECT *
       FROM academic_years
       WHERE school_id = $1 AND status IN ('active', 'open')
       ORDER BY is_current DESC, created_at DESC
       LIMIT 1`,
      [schoolId],
    );
  }

  async function listTermRows(schoolId) {
    const year = await findCurrentAcademicYear(schoolId);
    if (!year) return [];
    return all(
      `SELECT t.*, ay.name AS academic_year_name, ay.is_current
       FROM terms t
       JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE ay.id = $1
       ORDER BY t.start_date NULLS LAST, t.created_at, t.name`,
      [year.id],
    );
  }

  function mapPeriodRow(term, index) {
    return {
      id: term.id,
      name: term.name,
      type: inferPeriodType(term.name),
      order: index + 1,
      startDate: formatDisplayDate(term.start_date, repo.formatDate?.bind(repo)),
      endDate: formatDisplayDate(term.end_date, repo.formatDate?.bind(repo)),
      active: false,
    };
  }

  async function getSettings(schoolId) {
    return one(`SELECT * FROM school_settings WHERE school_id = $1`, [schoolId]);
  }

  async function upsertSettings(schoolId, patch) {
    const current = await getSettings(schoolId);
    const periodMode = patch.periodMode ?? current?.period_mode ?? "trimestre";
    const defaultScale = patch.defaultScale ?? Number(current?.default_scale ?? 20);
    const reportCardMode = patch.reportCardMode ?? current?.report_card_mode ?? "period";
    const row = await one(
      `INSERT INTO school_settings (school_id, period_mode, default_scale, report_card_mode, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (school_id) DO UPDATE SET
         period_mode = EXCLUDED.period_mode,
         default_scale = EXCLUDED.default_scale,
         report_card_mode = EXCLUDED.report_card_mode,
         updated_at = NOW()
       RETURNING *`,
      [schoolId, periodMode, defaultScale, reportCardMode],
    );
    return row;
  }

  async function seedDefaultSettingsIfEmpty(schoolId, defaults = {}) {
    const existing = await getSettings(schoolId);
    if (existing) return existing;
    return upsertSettings(schoolId, {
      periodMode: defaults.periodMode ?? "trimestre",
      defaultScale: defaults.defaultScale ?? 20,
      reportCardMode: defaults.reportCardMode ?? "period",
    });
  }

  async function seedDefaultTermsIfEmpty(schoolId) {
    let year = await findCurrentAcademicYear(schoolId);
    if (!year && typeof repo.ensureCurrentAcademicYearForSchool === "function") {
      year = await repo.ensureCurrentAcademicYearForSchool(schoolId);
    }
    if (!year) return [];
    const existing = await all(`SELECT * FROM terms WHERE academic_year_id = $1`, [year.id]);
    if (existing.length) return existing;
    const defaults = defaultAcademicPeriods();
    const inserted = [];
    for (const period of defaults) {
      const row = await one(
        `INSERT INTO terms (academic_year_id, name, start_date, end_date, status)
         VALUES ($1, $2, $3, $4, 'open')
         ON CONFLICT (academic_year_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING *`,
        [year.id, period.name, toIsoDate(period.startDate), toIsoDate(period.endDate)],
      );
      inserted.push(row);
    }
    return inserted;
  }

  async function replaceTerms(schoolId, periods) {
    const year = await findCurrentAcademicYear(schoolId);
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

    const existing = await all(`SELECT * FROM terms WHERE academic_year_id = $1`, [year.id]);
    const incomingSet = new Set(names.map((name) => name.toLowerCase()));
    for (const term of existing) {
      if (incomingSet.has(String(term.name).toLowerCase())) continue;
      const used = await one(`SELECT 1 FROM evaluations WHERE term_id = $1 LIMIT 1`, [term.id]);
      if (used) {
        throw createSchoolSettingsError(
          409,
          `La période « ${term.name} » est utilisée par des évaluations.`,
          SCHOOL_SETTINGS_ERROR.TERM_IN_USE,
          { termId: term.id, name: term.name },
        );
      }
    }

    for (const term of existing) {
      if (incomingSet.has(String(term.name).toLowerCase())) continue;
      await query(`DELETE FROM terms WHERE id = $1`, [term.id]);
    }

    const saved = [];
    for (const period of incoming) {
      const name = asTrimmed(period.name);
      const startDate = toIsoDate(period.startDate ?? period.start_date);
      const endDate = toIsoDate(period.endDate ?? period.end_date);
      const row = await one(
        `INSERT INTO terms (academic_year_id, name, start_date, end_date, status)
         VALUES ($1, $2, $3, $4, 'open')
         ON CONFLICT (academic_year_id, name) DO UPDATE SET
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           updated_at = NOW()
         RETURNING *`,
        [year.id, name, startDate, endDate],
      );
      saved.push(row);
    }
    return saved;
  }

  async function projectAcademicConfig(schoolCode) {
    const school = await requireSchoolByCode(schoolCode);
    const settingsRow = (await getSettings(school.id)) ?? {
      school_id: school.id,
      period_mode: "trimestre",
      default_scale: 20,
      report_card_mode: "period",
    };
    const settings = mapSettingsRow(settingsRow, school.school_code);
    const termRows = await listTermRows(school.id);
    const periods = withSystemActivePeriods({
      periods: termRows.map((row, index) => mapPeriodRow(row, index)),
    }).periods;
    const year = await findCurrentAcademicYear(school.id);
    let levels = [];
    let tracks = [];
    let userRoles = [];
    let evaluationTypes = [];
    if (typeof repo.getSchoolEducationActiveLists === "function") {
      const lists = await repo.getSchoolEducationActiveLists(school.school_code);
      levels = lists.levels ?? [];
      tracks = lists.tracks ?? [];
    }
    if (typeof repo.listEstablishmentRoles === "function") {
      userRoles = (await repo.listEstablishmentRoles({ schoolAssignableOnly: true })).map((row) => row.roleName);
    }
    if (typeof repo.listEvaluationTypeNames === "function") {
      evaluationTypes = await repo.listEvaluationTypeNames(school.school_code);
    }
    return {
      schoolCode: school.school_code,
      schoolYear: year?.name ?? "",
      periodMode: settings.periodMode || inferPeriodMode(periods),
      periods,
      evaluationTypes,
      defaultScale: settings.defaultScale,
      reportCardMode: settings.reportCardMode,
      levels,
      tracks,
      userRoles,
      classNames: await listClassNames(school.id),
      subjects: await listSubjectNames(school.id),
    };
  }

  async function inventoryLegacySchoolSettingsPayloads() {
    const rows = await all(
      `SELECT s.id AS school_id, s.school_code, sac.config_payload
       FROM school_academic_configs sac
       JOIN schools s ON s.id = sac.school_id`,
    );
    const inventory = [];
    const ambiguous = [];
    for (const row of rows) {
      let payload = row.config_payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      const termRows = await listTermRows(row.school_id);
      const classNames = await listClassNames(row.school_id);
      const subjectNames = await listSubjectNames(row.school_id);
      const classified = classifyLegacySchoolSettings(payload, {
        termNames: termRows.map((term) => term.name),
        classNames,
        subjectNames,
      });
      inventory.push({ schoolCode: row.school_code, issues: classified.issues });
      if (classified.ambiguous) {
        ambiguous.push({
          schoolCode: row.school_code,
          issues: classified.issues,
          keys: classified.issues.map((item) => item.key),
        });
      }
    }
    return { inventory, ambiguous };
  }

  async function bootstrapCanonicalSettingsForAllSchools() {
    const schools = await all(`SELECT id, school_code FROM schools`);
    for (const school of schools) {
      const row = await one(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [school.id]);
      let payload = row?.config_payload ?? {};
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      const defaults = {};
      if (isValidPeriodMode(payload.periodMode)) defaults.periodMode = payload.periodMode;
      if (isValidDefaultScale(payload.defaultScale)) defaults.defaultScale = Number(payload.defaultScale);
      else if (isValidDefaultScale(payload.defaultGradeScale)) defaults.defaultScale = Number(payload.defaultGradeScale);
      if (isValidReportCardMode(payload.reportCardMode)) defaults.reportCardMode = payload.reportCardMode;
      await seedDefaultSettingsIfEmpty(school.id, defaults);
      await seedDefaultTermsIfEmpty(school.id);
    }
  }

  return {
    getSchoolByCode,
    requireSchoolByCode,
    listClassNames,
    listSubjectNames,
    listTermRows,
    getSettings,
    upsertSettings,
    seedDefaultSettingsIfEmpty,
    seedDefaultTermsIfEmpty,
    replaceTerms,
    projectAcademicConfig,
    inventoryLegacySchoolSettingsPayloads,
    bootstrapCanonicalSettingsForAllSchools,
    mapPeriodRow,
  };
}

module.exports = {
  createSchoolSettingsPgStore,
  toIsoDate,
};
