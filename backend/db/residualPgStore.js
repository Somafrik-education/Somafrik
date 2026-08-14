"use strict";

const { withSystemActivePeriods, defaultAcademicPeriods, inferPeriodMode } = require("../lib/academicConfigDefaults");
const seedData = require("../data");
const { resolveRecordId } = require("./residualMemoryStore");

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function mapResidualRow(row, schoolCode) {
  const payload = parsePayload(row.profile_payload);
  return {
    ...payload,
    id: payload.id ?? row.legacy_json_id ?? row.id,
    schoolCode: payload.schoolCode ?? schoolCode,
  };
}

function createResidualPgStore(repo) {
  const one = (...args) => repo.one(...args);
  const all = (...args) => repo.all(...args);
  const query = (...args) => repo.query(...args);

  async function resolveSchool(schoolCode) {
    const normalized = String(schoolCode ?? "").trim().toUpperCase();
    if (!normalized || normalized === "*") {
      return repo.getSchoolByCode(seedData.school.code);
    }
    return repo.getSchoolByCode(normalized);
  }

  const store = {
    async listProjection() {
      const configRows = await all(
        `SELECT sac.config_payload, s.school_code
         FROM school_academic_configs sac
         JOIN schools s ON s.id = sac.school_id`,
      );
      const academicConfigs = {};
      for (const row of configRows) {
        const payload = parsePayload(row.config_payload);
        academicConfigs[String(row.school_code).toUpperCase()] = {
          ...payload,
          schoolCode: String(row.school_code).toUpperCase(),
        };
      }

      const residualRows = await all(
        `SELECT r.*, s.school_code
         FROM establishment_residual_records r
         JOIN schools s ON s.id = r.school_id
         WHERE r.archived_at IS NULL`,
      );
      const exams = [];
      const bulletins = [];
      const documents = [];
      for (const row of residualRows) {
        const mapped = mapResidualRow(row, String(row.school_code).toUpperCase());
        if (row.record_domain === "exam") exams.push(mapped);
        if (row.record_domain === "bulletin") bulletins.push(mapped);
        if (row.record_domain === "document") documents.push(mapped);
      }
      return { academicConfigs, exams, bulletins, documents };
    },

    async getAcademicConfig(schoolCode) {
      const school = await resolveSchool(schoolCode);
      if (!school) return null;
      const row = await one(
        `SELECT config_payload FROM school_academic_configs WHERE school_id = $1`,
        [school.id],
      );
      const storedConfig = parsePayload(row?.config_payload);
      const termRows = await all(
        `SELECT t.*
         FROM terms t
         JOIN academic_years ay ON ay.id = t.academic_year_id
         WHERE ay.school_id = $1
         ORDER BY t.start_date NULLS LAST, t.created_at`,
        [school.id],
      );
      const periods = termRows.length
        ? termRows.map((term, index) => ({
            name: term.name,
            type: term.name.toLowerCase().includes("semestre")
              ? "Semestre"
              : term.name.toLowerCase().includes("trimestre")
                ? "Trimestre"
                : "Période",
            startDate: repo.formatDate(term.start_date),
            endDate: repo.formatDate(term.end_date),
            active: index === 0,
          }))
        : defaultAcademicPeriods();

      return withSystemActivePeriods({
        schoolCode: school.school_code ?? school.code,
        periodMode: storedConfig?.periodMode ?? inferPeriodMode(periods),
        periods: Array.isArray(storedConfig?.periods) && storedConfig.periods.length
          ? storedConfig.periods
          : periods,
        evaluationTypes: Array.isArray(storedConfig?.evaluationTypes) && storedConfig.evaluationTypes.length
          ? storedConfig.evaluationTypes
          : ["Interrogation", "Devoir", "Examen", "Travail pratique", "Projet"],
        defaultScale: Number(storedConfig?.defaultScale ?? 20),
        reportCardMode: storedConfig?.reportCardMode ?? "period",
        allowCustomClasses: storedConfig?.allowCustomClasses !== false,
        allowCustomCourses: storedConfig?.allowCustomCourses !== false,
        allowCustomReportCards: storedConfig?.allowCustomReportCards !== false,
        levels: Array.isArray(storedConfig?.levels) && storedConfig.levels.length
          ? storedConfig.levels
          : seedData.demoLevels,
        tracks: Array.isArray(storedConfig?.tracks) && storedConfig.tracks.length
          ? storedConfig.tracks
          : seedData.demoTracks,
        classNames: Array.isArray(storedConfig?.classNames) && storedConfig.classNames.length
          ? storedConfig.classNames
          : seedData.demoClassNames,
        subjects: Array.isArray(storedConfig?.subjects) && storedConfig.subjects.length
          ? storedConfig.subjects
          : seedData.demoSubjects,
      });
    },

    async saveAcademicConfig(schoolCode, config) {
      const school = await resolveSchool(config.schoolCode ?? schoolCode);
      if (!school) {
        const error = new Error("Établissement introuvable.");
        error.statusCode = 404;
        throw error;
      }
      const normalizedSchoolCode = String(school.school_code ?? school.code).trim().toUpperCase();
      const savedConfig = withSystemActivePeriods({
        schoolCode: normalizedSchoolCode,
        periodMode: config.periodMode ?? "trimestre",
        periods: Array.isArray(config.periods) && config.periods.length ? config.periods : defaultAcademicPeriods(),
        evaluationTypes: Array.isArray(config.evaluationTypes) && config.evaluationTypes.length
          ? config.evaluationTypes
          : ["Interrogation", "Devoir", "Examen", "Travail pratique", "Projet"],
        defaultScale: Number(config.defaultScale ?? 20),
        reportCardMode: config.reportCardMode ?? "period",
        allowCustomClasses: config.allowCustomClasses !== false,
        allowCustomCourses: config.allowCustomCourses !== false,
        allowCustomReportCards: config.allowCustomReportCards !== false,
        levels: Array.isArray(config.levels) && config.levels.length ? config.levels : seedData.demoLevels,
        tracks: Array.isArray(config.tracks) && config.tracks.length ? config.tracks : seedData.demoTracks,
        classNames: Array.isArray(config.classNames) && config.classNames.length
          ? config.classNames
          : seedData.demoClassNames,
        subjects: Array.isArray(config.subjects) && config.subjects.length
          ? config.subjects
          : seedData.demoSubjects,
      });
      await query(
        `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (school_id) DO UPDATE SET
           config_payload = EXCLUDED.config_payload,
           updated_at = NOW()`,
        [school.id, JSON.stringify(savedConfig)],
      );
      return savedConfig;
    },

    async replaceDomainRecords(domain, schoolCode, items = [], tx = null) {
      const school = await resolveSchool(schoolCode);
      if (!school) {
        const error = new Error("Établissement introuvable.");
        error.statusCode = 404;
        throw error;
      }
      const normalizedSchool = String(school.school_code ?? school.code).trim().toUpperCase();
      const runner = tx ?? repo;
      const scopedItems = (items ?? []).filter(
        (item) => String(item?.schoolCode ?? normalizedSchool).trim().toUpperCase() === normalizedSchool,
      );
      const nextIds = new Set(scopedItems.map((item) => resolveRecordId(item)).filter(Boolean));

      await runner.query(
        `UPDATE establishment_residual_records
         SET archived_at = NOW(), status = 'archived', updated_at = NOW()
         WHERE school_id = $1 AND record_domain = $2 AND archived_at IS NULL
           AND NOT (legacy_json_id = ANY($3::text[]))`,
        [school.id, domain, [...nextIds]],
      );

      for (const item of scopedItems) {
        const legacyId = resolveRecordId(item);
        if (!legacyId) continue;
        const payload = { ...item, schoolCode: item.schoolCode ?? normalizedSchool };
        await runner.query(
          `INSERT INTO establishment_residual_records (
             school_id, record_domain, legacy_json_id, profile_payload, status, archived_at, updated_at
           ) VALUES ($1, $2, $3, $4::jsonb, 'active', NULL, NOW())
           ON CONFLICT (school_id, record_domain, legacy_json_id) DO UPDATE SET
             profile_payload = EXCLUDED.profile_payload,
             status = 'active',
             archived_at = NULL,
             updated_at = NOW()`,
          [school.id, domain, legacyId, JSON.stringify(payload)],
        );
      }
      return scopedItems;
    },
  };

  return store;
}

module.exports = {
  createResidualPgStore,
  mapResidualRow,
};
