"use strict";

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

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function resolveRecordId(row = {}) {
  return asTrimmed(row.id ?? row.publicId ?? row.code ?? "");
}

function mapResidualRow(row, schoolCode) {
  const payload = row.profile_payload && typeof row.profile_payload === "object" ? row.profile_payload : {};
  return {
    ...payload,
    id: payload.id ?? row.legacy_json_id ?? row.id,
    schoolCode: payload.schoolCode ?? schoolCode,
  };
}

function createResidualMemoryStore() {
  const academicConfigs = new Map();
  const records = {
    exam: [],
    bulletin: [],
    document: [],
  };

  const store = {
    listProjection() {
      const exams = records.exam.map((row) => mapResidualRow(row, row.schoolCode));
      const bulletins = records.bulletin.map((row) => mapResidualRow(row, row.schoolCode));
      const documents = records.document.map((row) => mapResidualRow(row, row.schoolCode));
      const configs = {};
      for (const [schoolCode, config] of academicConfigs.entries()) {
        configs[schoolCode] = config;
      }
      return { academicConfigs: configs, exams, bulletins, documents };
    },
    getAcademicConfig(schoolCode) {
      const normalized = asTrimmed(schoolCode).toUpperCase();
      return academicConfigs.get(normalized) ?? null;
    },
    saveAcademicConfig(schoolCode, config, _tx = null) {
      assertNoLegacyAcademicLevelsTracksWrite(config);
      assertNoLegacyUserRolesWrite(config);
      assertNoLegacyEvaluationTypesWrite(config);
      assertNoLegacySchoolSettingsWrite(config);
      stripLegacySchoolSettings(
        stripLegacyEvaluationTypes(stripLegacyUserRoles(stripLegacyAcademicLevelsTracks(config))),
      );
      const normalized = asTrimmed(schoolCode).toUpperCase();
      const saved = { schoolCode: normalized };
      academicConfigs.set(normalized, saved);
      return saved;
    },
    replaceDomainRecords(domain, schoolCode, items = []) {
      const normalizedSchool = asTrimmed(schoolCode).toUpperCase();
      const scopedItems = (items ?? []).map((item) => ({
        ...(item && typeof item === "object" ? item : {}),
        schoolCode: normalizedSchool,
      }));
      const nextIds = new Set(scopedItems.map((item) => resolveRecordId(item)).filter(Boolean));
      records[domain] = records[domain].filter((row) => {
        if (asTrimmed(row.schoolCode).toUpperCase() !== normalizedSchool) {
          return true;
        }
        return nextIds.has(resolveRecordId(row));
      });
      for (const item of scopedItems) {
        const legacyId = resolveRecordId(item);
        if (!legacyId) continue;
        const existingIndex = records[domain].findIndex(
          (row) =>
            asTrimmed(row.schoolCode).toUpperCase() === normalizedSchool &&
            resolveRecordId(row) === legacyId,
        );
        const entry = {
          schoolCode: normalizedSchool,
          legacy_json_id: legacyId,
          profile_payload: { ...item, schoolCode: normalizedSchool },
        };
        if (existingIndex >= 0) {
          records[domain][existingIndex] = entry;
        } else {
          records[domain].push(entry);
        }
      }
      return items;
    },
  };

  return store;
}

module.exports = {
  createResidualMemoryStore,
  mapResidualRow,
  resolveRecordId,
};
