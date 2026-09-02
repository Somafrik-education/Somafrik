"use strict";

const { withSystemActivePeriods } = require("../lib/academicConfigDefaults");
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
      void residualRows;
      return { academicConfigs, exams: [], bulletins: [], documents: [] };
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
      let levels = [];
      let tracks = [];
      let userRoles = [];
      let evaluationTypes = [];
      if (typeof repo.getSchoolEducationActiveLists === "function") {
        const lists = await repo.getSchoolEducationActiveLists(school.school_code ?? school.code);
        levels = lists.levels ?? [];
        tracks = lists.tracks ?? [];
      }
      if (typeof repo.listEstablishmentRoles === "function") {
        userRoles = (await repo.listEstablishmentRoles({ schoolAssignableOnly: true })).map((row) => row.roleName);
      }
      if (typeof repo.listEvaluationTypeNames === "function") {
        evaluationTypes = await repo.listEvaluationTypeNames(school.school_code ?? school.code);
      }
      return withSystemActivePeriods({
        schoolCode: school.school_code ?? school.code,
        periodMode: "trimestre",
        periods: [],
        evaluationTypes,
        defaultScale: 20,
        reportCardMode: "period",
        levels,
        tracks,
        userRoles,
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
      const { assertLegacyResidualWriteForbidden } = require("../lib/documentsExamsManagement");
      assertLegacyResidualWriteForbidden(domain);
      void schoolCode;
      void items;
      void tx;
      return [];
    },
  };

  return store;
}

module.exports = {
  createResidualPgStore,
  mapResidualRow,
};
