"use strict";

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

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function createEvaluationTypesPgStore(repo) {
  const one = (...args) => repo.one(...args);
  const all = (...args) => repo.all(...args);
  const query = (...args) => repo.query(...args);

  async function getSchoolByCode(schoolCode) {
    const { canonicalSchoolLoginOrNull } = require("../lib/schoolCodeV2");
    const normalized = canonicalSchoolLoginOrNull(schoolCode);
    if (!normalized) return null;
    return one(
      `SELECT s.id, s.login_code AS school_code, s.login_code
       FROM schools s
       WHERE upper(s.login_code) = $1
       LIMIT 1`,
      [normalized],
    );
  }

  async function getSchoolById(schoolId) {
    return one(`SELECT id, login_code AS school_code, login_code FROM schools WHERE id = $1::uuid`, [schoolId]);
  }

  async function requireSchoolByCode(schoolCode) {
    const school = await getSchoolByCode(schoolCode);
    if (!school) {
      throw createEvaluationTypesError(404, "Établissement introuvable.", EVALUATION_TYPES_ERROR.SCHOOL_NOT_FOUND);
    }
    return school;
  }

  async function listBySchool(schoolCode, { includeArchived = false } = {}) {
    const school = await getSchoolByCode(schoolCode);
    if (!school) return [];
    const rows = await all(
      `SELECT et.*, s.login_code AS school_code
       FROM evaluation_types et
       JOIN schools s ON s.id = et.school_id
       WHERE et.school_id = $1
         AND ($2::boolean OR et.status = 'active')
       ORDER BY et.display_order, et.name`,
      [school.id, includeArchived],
    );
    return rows.map((row) => mapEvaluationTypeRow(row, row.school_code));
  }

  async function listActiveNames(schoolCode) {
    const rows = await listBySchool(schoolCode, { includeArchived: false });
    return rows.map((row) => row.name);
  }

  async function getById(typeId) {
    const row = await one(
      `SELECT et.*, s.login_code AS school_code
       FROM evaluation_types et
       JOIN schools s ON s.id = et.school_id
       WHERE et.id = $1::uuid`,
      [typeId],
    );
    return row ? mapEvaluationTypeRow(row, row.school_code) : null;
  }

  async function findUsableType(schoolId, { id, code, name } = {}) {
    const typeId = asTrimmed(id);
    if (typeId) {
      const row = await one(
        `SELECT et.*, s.login_code AS school_code
         FROM evaluation_types et
         JOIN schools s ON s.id = et.school_id
         WHERE et.id = $1::uuid AND et.school_id = $2::uuid`,
        [typeId, schoolId],
      );
      return row ? mapEvaluationTypeRow(row, row.school_code) : null;
    }
    const normalizedCode = normalizeCode(code || name);
    const normalizedName = normalizeTypeLabel(name || code);
    if (!normalizedCode && !normalizedName) return null;
    const row = await one(
      `SELECT et.*, s.login_code AS school_code
       FROM evaluation_types et
       JOIN schools s ON s.id = et.school_id
       WHERE et.school_id = $1::uuid
         AND (
           et.code = $2
           OR lower(btrim(et.name)) = $3
         )
       ORDER BY CASE WHEN et.status = 'active' THEN 0 ELSE 1 END, et.display_order
       LIMIT 1`,
      [schoolId, normalizedCode, normalizedName],
    );
    return row ? mapEvaluationTypeRow(row, row.school_code) : null;
  }

  async function insertType(input) {
    const row = await one(
      `INSERT INTO evaluation_types (school_id, code, name, display_order, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [input.schoolId, input.code, input.name, input.displayOrder ?? 0],
    );
    const school = await getSchoolById(input.schoolId);
    return mapEvaluationTypeRow({ ...row, school_code: school?.school_code }, school?.school_code);
  }

  async function updateType(typeId, patch) {
    const row = await one(
      `UPDATE evaluation_types
       SET name = COALESCE($2, name),
           display_order = COALESCE($3, display_order),
           updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [typeId, patch.name ?? null, patch.displayOrder ?? null],
    );
    if (!row) return null;
    const school = await getSchoolById(row.school_id);
    return mapEvaluationTypeRow({ ...row, school_code: school?.school_code }, school?.school_code);
  }

  async function archiveType(typeId) {
    const row = await one(
      `UPDATE evaluation_types
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [typeId],
    );
    if (!row) return null;
    const school = await getSchoolById(row.school_id);
    return mapEvaluationTypeRow({ ...row, school_code: school?.school_code }, school?.school_code);
  }

  async function countBySchool(schoolId) {
    const row = await one(`SELECT COUNT(*)::int AS count FROM evaluation_types WHERE school_id = $1`, [schoolId]);
    return Number(row?.count ?? 0);
  }

  async function seedDefaultTypesIfEmpty(schoolId) {
    const count = await countBySchool(schoolId);
    if (count > 0) return [];
    const created = [];
    for (const item of DEFAULT_EVALUATION_TYPES) {
      created.push(
        await insertType({
          schoolId,
          code: item.code,
          name: item.name,
          displayOrder: item.displayOrder,
        }),
      );
    }
    return created;
  }

  async function bootstrapCanonicalTypesForAllSchools() {
    const schools = await all(`SELECT id, login_code AS school_code FROM schools WHERE deleted_at IS NULL`);
    for (const school of schools) {
      await seedDefaultTypesIfEmpty(school.id);
    }
  }

  async function inventoryLegacyEvaluationTypesPayloads() {
    const rows = await all(
      `SELECT s.school_code, sac.config_payload
       FROM school_academic_configs sac
       JOIN schools s ON s.id = sac.school_id`,
    );
    const inventory = [];
    const ambiguous = [];
    for (const row of rows) {
      const payload = parsePayload(row.config_payload);
      const labels = extractLegacyEvaluationTypeLabels(payload);
      const entry = {
        schoolCode: row.school_code,
        typesCount: labels.length,
        typesSample: labels.slice(0, 5),
        ambiguous: isLegacyEvaluationTypesAmbiguous(payload),
      };
      inventory.push(entry);
      if (entry.ambiguous) ambiguous.push(entry);
    }
    return { inventory, ambiguous };
  }

  return {
    getSchoolByCode,
    requireSchoolByCode,
    listBySchool,
    listActiveNames,
    getById,
    findUsableType,
    insertType,
    updateType,
    archiveType,
    countBySchool,
    seedDefaultTypesIfEmpty,
    bootstrapCanonicalTypesForAllSchools,
    inventoryLegacyEvaluationTypesPayloads,
    normalizeCode,
  };
}

module.exports = {
  createEvaluationTypesPgStore,
};
