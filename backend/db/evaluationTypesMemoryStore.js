"use strict";

const { randomUUID } = require("node:crypto");
const {
  EVALUATION_TYPES_ERROR,
  DEFAULT_EVALUATION_TYPES,
  asTrimmed,
  normalizeCode,
  normalizeTypeLabel,
  createEvaluationTypesError,
  mapEvaluationTypeRow,
  isLegacyEvaluationTypesAmbiguous,
  extractLegacyEvaluationTypeLabels,
} = require("../lib/evaluationTypesManagement");

function createEvaluationTypesMemoryStore(seed = {}) {
  const types = [];
  const schools = new Map();
  const legacyPayloads = new Map();

  function rememberSchool(school) {
    const code = asTrimmed(school.code ?? school.schoolCode ?? school.school_code).toUpperCase();
    if (!code) return;
    const entry = {
      id: school.id ?? randomUUID(),
      school_code: code,
    };
    schools.set(code, entry);
    return entry;
  }

  for (const school of seed.schools ?? []) {
    rememberSchool(school);
  }
  if (seed.school) rememberSchool(seed.school);

  function schoolByCode(schoolCode) {
    return schools.get(asTrimmed(schoolCode).toUpperCase()) ?? null;
  }

  function rowType(type) {
    return mapEvaluationTypeRow(type, type.school_code);
  }

  return {
    setLegacyEvaluationTypesPayload(schoolCode, payload) {
      legacyPayloads.set(asTrimmed(schoolCode).toUpperCase(), payload);
    },
    async getSchoolByCode(schoolCode) {
      return schoolByCode(schoolCode);
    },
    async requireSchoolByCode(schoolCode) {
      const school = schoolByCode(schoolCode);
      if (!school) {
        throw createEvaluationTypesError(404, "Établissement introuvable.", EVALUATION_TYPES_ERROR.SCHOOL_NOT_FOUND);
      }
      return school;
    },
    async listBySchool(schoolCode, { includeArchived = false } = {}) {
      const school = schoolByCode(schoolCode);
      if (!school) return [];
      return types
        .filter((row) => row.school_id === school.id && (includeArchived || row.status === "active"))
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "fr"))
        .map(rowType);
    },
    async listActiveNames(schoolCode) {
      const rows = await this.listBySchool(schoolCode, { includeArchived: false });
      return rows.map((row) => row.name);
    },
    async getById(typeId) {
      const row = types.find((item) => item.id === typeId);
      return row ? rowType(row) : null;
    },
    async findUsableType(schoolId, { id, code, name } = {}) {
      const typeId = asTrimmed(id);
      if (typeId) {
        const row = types.find((item) => item.id === typeId && item.school_id === schoolId);
        return row ? rowType(row) : null;
      }
      const normalizedCode = normalizeCode(code || name);
      const normalizedName = normalizeTypeLabel(name || code);
      if (!normalizedCode && !normalizedName) return null;
      const matches = types.filter(
        (item) =>
          item.school_id === schoolId &&
          (item.code === normalizedCode || normalizeTypeLabel(item.name) === normalizedName),
      );
      matches.sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1));
      return matches[0] ? rowType(matches[0]) : null;
    },
    async insertType(input) {
      const school =
        [...schools.values()].find((row) => row.id === input.schoolId) ??
        (input.schoolCode ? schoolByCode(input.schoolCode) : null);
      const duplicate = types.some(
        (row) =>
          row.school_id === input.schoolId &&
          (row.code === input.code || normalizeTypeLabel(row.name) === normalizeTypeLabel(input.name)),
      );
      if (duplicate) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      const row = {
        id: randomUUID(),
        school_id: input.schoolId,
        school_code: school?.school_code ?? "",
        code: input.code,
        name: input.name,
        display_order: input.displayOrder ?? 0,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      types.push(row);
      return rowType(row);
    },
    async updateType(typeId, patch) {
      const row = types.find((item) => item.id === typeId && item.status === "active");
      if (!row) return null;
      if (patch.name) {
        const clash = types.some(
          (item) =>
            item.id !== typeId &&
            item.school_id === row.school_id &&
            normalizeTypeLabel(item.name) === normalizeTypeLabel(patch.name),
        );
        if (clash) {
          const error = new Error("duplicate");
          error.code = "23505";
          throw error;
        }
        row.name = patch.name;
      }
      if (patch.displayOrder != null) row.display_order = patch.displayOrder;
      row.updated_at = new Date().toISOString();
      return rowType(row);
    },
    async archiveType(typeId) {
      const row = types.find((item) => item.id === typeId && item.status === "active");
      if (!row) return null;
      row.status = "archived";
      row.updated_at = new Date().toISOString();
      return rowType(row);
    },
    async countBySchool(schoolId) {
      return types.filter((row) => row.school_id === schoolId).length;
    },
    async seedDefaultTypesIfEmpty(schoolId) {
      const count = await this.countBySchool(schoolId);
      if (count > 0) return [];
      const created = [];
      for (const item of DEFAULT_EVALUATION_TYPES) {
        created.push(
          await this.insertType({
            schoolId,
            code: item.code,
            name: item.name,
            displayOrder: item.displayOrder,
          }),
        );
      }
      return created;
    },
    async bootstrapCanonicalTypesForAllSchools() {
      for (const school of schools.values()) {
        await this.seedDefaultTypesIfEmpty(school.id);
      }
    },
    async inventoryLegacyEvaluationTypesPayloads() {
      const inventory = [];
      const ambiguous = [];
      for (const [schoolCode, payload] of legacyPayloads.entries()) {
        const labels = extractLegacyEvaluationTypeLabels(payload);
        const entry = {
          schoolCode,
          typesCount: labels.length,
          typesSample: labels.slice(0, 5),
          ambiguous: isLegacyEvaluationTypesAmbiguous(payload),
        };
        inventory.push(entry);
        if (entry.ambiguous) ambiguous.push(entry);
      }
      return { inventory, ambiguous };
    },
    snapshot() {
      return types.map((row) => ({ ...row }));
    },
    restore(snapshot) {
      types.splice(0, types.length, ...snapshot.map((row) => ({ ...row })));
    },
    normalizeCode,
  };
}

module.exports = {
  createEvaluationTypesMemoryStore,
};
