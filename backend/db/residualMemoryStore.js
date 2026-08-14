"use strict";

const { withSystemActivePeriods } = require("../lib/academicConfigDefaults");
const seedData = require("../data");

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
      const normalized = asTrimmed(schoolCode).toUpperCase();
      const saved = withSystemActivePeriods({
        schoolCode: normalized,
        periodMode: config.periodMode ?? "trimestre",
        periods: Array.isArray(config.periods) && config.periods.length ? config.periods : [],
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
      academicConfigs.set(normalized, saved);
      return saved;
    },
    replaceDomainRecords(domain, schoolCode, items = []) {
      const normalizedSchool = asTrimmed(schoolCode).toUpperCase();
      const nextIds = new Set(items.map((item) => resolveRecordId(item)).filter(Boolean));
      records[domain] = records[domain].filter((row) => {
        if (asTrimmed(row.schoolCode).toUpperCase() !== normalizedSchool) {
          return true;
        }
        return nextIds.has(resolveRecordId(row));
      });
      for (const item of items) {
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
          profile_payload: { ...item, schoolCode: item.schoolCode ?? normalizedSchool },
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
