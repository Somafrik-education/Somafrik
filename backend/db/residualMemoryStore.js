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
      const configs = {};
      for (const [schoolCode, config] of academicConfigs.entries()) {
        configs[schoolCode] = config;
      }
      return { academicConfigs: configs, exams: [], bulletins: [], documents: [] };
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
      const { assertLegacyResidualWriteForbidden } = require("../lib/documentsExamsManagement");
      assertLegacyResidualWriteForbidden(domain);
      void schoolCode;
      void items;
      return [];
    },
  };

  return store;
}

module.exports = {
  createResidualMemoryStore,
  mapResidualRow,
  resolveRecordId,
};
