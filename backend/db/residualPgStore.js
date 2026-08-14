"use strict";

const { withSystemActivePeriods, defaultAcademicPeriods, inferPeriodMode } = require("../lib/academicConfigDefaults");
const seedData = require("../data");
const { resolveRecordId } = require("./residualMemoryStore");
const {
  assertNoLegacyAcademicLevelsTracksWrite,
  stripLegacyAcademicLevelsTracks,
} = require("../lib/educationReferenceManagement");
const {
  assertNoLegacyUserRolesWrite,
  stripLegacyUserRoles,
} = require("../lib/establishmentRolesManagement");
const {
  assertNoLegacyEvaluationTypesWrite,
  stripLegacyEvaluationTypes,
} = require("../lib/evaluationTypesManagement");
const {
  assertNoLegacySchoolSettingsWrite,
  stripLegacySchoolSettings,
} = require("../lib/schoolSettingsManagement");

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
      const schoolRows = await all(`SELECT id, school_code FROM schools`);
      const academicConfigs = {};
      for (const row of schoolRows) {
        const code = String(row.school_code).toUpperCase();
        if (typeof repo.getSchoolSettingsStore === "function") {
          try {
            academicConfigs[code] = await repo.getSchoolSettingsStore().projectAcademicConfig(code);
          } catch (error) {
            if (error?.code === "SCHOOL_NOT_FOUND" || error?.statusCode === 404) {
              academicConfigs[code] = { schoolCode: code };
            } else {
              throw error;
            }
          }
        } else {
          const configRow = await one(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [
            row.id,
          ]);
          academicConfigs[code] = { ...parsePayload(configRow?.config_payload), schoolCode: code };
        }
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
      if (typeof repo.getSchoolSettingsStore === "function") {
        const normalized = String(schoolCode ?? "").trim().toUpperCase();
        try {
          return await repo.getSchoolSettingsStore().projectAcademicConfig(normalized);
        } catch (error) {
          if (error?.code === "SCHOOL_NOT_FOUND" || error?.statusCode === 404) return null;
          throw error;
        }
      }
      const school = await resolveSchool(schoolCode);
      if (!school) return null;
      const row = await one(
        `SELECT config_payload FROM school_academic_configs WHERE school_id = $1`,
        [school.id],
      );
      const storedConfig = parsePayload(row?.config_payload);
      return withSystemActivePeriods({
        schoolCode: school.school_code ?? school.code,
        periodMode: storedConfig?.periodMode ?? inferPeriodMode(defaultAcademicPeriods()),
        periods: defaultAcademicPeriods(),
        evaluationTypes: [],
        defaultScale: Number(storedConfig?.defaultScale ?? 20),
        reportCardMode: storedConfig?.reportCardMode ?? "period",
        levels: [],
        tracks: [],
        userRoles: [],
        classNames: [],
        subjects: [],
      });
    },

    async saveAcademicConfig(schoolCode, config, tx = null) {
      assertNoLegacyAcademicLevelsTracksWrite(config);
      assertNoLegacyUserRolesWrite(config);
      assertNoLegacyEvaluationTypesWrite(config);
      assertNoLegacySchoolSettingsWrite(config);
      stripLegacySchoolSettings(
        stripLegacyEvaluationTypes(stripLegacyUserRoles(stripLegacyAcademicLevelsTracks(config))),
      );
      const school = await resolveSchool(schoolCode);
      if (!school) {
        const error = new Error("Établissement introuvable.");
        error.statusCode = 404;
        throw error;
      }
      const normalizedSchoolCode = String(school.school_code ?? school.code).trim().toUpperCase();
      const runner = tx && typeof tx.query === "function" ? tx : repo;
      await runner.query(
        `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (school_id) DO UPDATE SET
           config_payload = EXCLUDED.config_payload,
           updated_at = NOW()`,
        [school.id, JSON.stringify({})],
      );
      if (typeof repo.getSchoolSettingsStore === "function") {
        return repo.getSchoolSettingsStore().projectAcademicConfig(normalizedSchoolCode);
      }
      return { schoolCode: normalizedSchoolCode };
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
      const scopedItems = (items ?? []).map((item) => ({
        ...(item && typeof item === "object" ? item : {}),
        schoolCode: normalizedSchool,
      }));
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
        const payload = { ...item, schoolCode: normalizedSchool };
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
