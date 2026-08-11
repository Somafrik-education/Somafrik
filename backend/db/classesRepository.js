"use strict";

const {
  generateClassCode,
  validateCreateClassInput,
  validateUpdateClassInput,
  requireClassCodeParam,
  createHttpError,
  asTrimmedString,
} = require("../lib/classesManagement");
const {
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
} = require("../lib/classesUniqueness");

/**
 * Dedicated PostgreSQL repository for establishment classes.
 * Does not read or write backoffice_state JSON.
 *
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 *   getSchoolByCode: (code: string) => Promise<any>,
 * }} db
 */
function createClassesRepository(db) {
  /**
   * @param {any} row
   */
  function mapClassRow(row) {
    const classCode = row.class_code;
    return {
      id: classCode,
      publicId: classCode,
      classCode,
      name: row.name,
      level: row.level ?? "",
      section: row.section ?? "",
      track: row.section ?? "",
      status: row.status,
      schoolCode: row.school_code,
      academicYearId: row.academic_year_id,
      academicYearName: row.academic_year_name,
      schoolYear: row.academic_year_name,
      students: Number(row.enrollment_count ?? 0),
      teacher: "Non assigne",
      presenceRate: 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function nameConflictError(name) {
    return createHttpError(
      409,
      `La classe « ${name} » existe déjà pour cette année scolaire dans l'établissement.`,
    );
  }

  async function requireSchool(schoolCode) {
    const code = asTrimmedString(schoolCode);
    if (!code || code === "*") {
      throw createHttpError(400, "schoolCode établissement requis.");
    }
    const school = await db.getSchoolByCode(code);
    if (!school) {
      throw createHttpError(404, "Établissement introuvable.");
    }
    return school;
  }

  async function resolveAcademicYearForSchool(schoolId, academicYearName) {
    const year = await db.one(
      `SELECT id, name
       FROM academic_years
       WHERE school_id = $1 AND name = $2
       LIMIT 1`,
      [schoolId, academicYearName],
    );
    if (!year) {
      throw createHttpError(
        400,
        "Année scolaire introuvable pour cet établissement.",
      );
    }
    return year;
  }

  return {
    /**
     * @param {string} schoolCode
     */
    async listBySchoolCode(schoolCode) {
      const school = await requireSchool(schoolCode);
      const rows = await db.all(
        `SELECT cl.id,
                cl.class_code,
                cl.name,
                cl.level,
                cl.section,
                cl.status,
                cl.academic_year_id,
                cl.created_at,
                cl.updated_at,
                s.school_code,
                ay.name AS academic_year_name,
                COUNT(e.id) FILTER (WHERE e.status = 'active')::int AS enrollment_count
         FROM classes cl
         JOIN schools s ON s.id = cl.school_id
         JOIN academic_years ay ON ay.id = cl.academic_year_id
         LEFT JOIN enrollments e ON e.class_id = cl.id
         WHERE cl.school_id = $1
         GROUP BY cl.id, s.school_code, ay.name
         ORDER BY cl.name ASC, cl.class_code ASC`,
        [school.id],
      );
      return rows.map(mapClassRow);
    },

    /**
     * @param {unknown} body
     * @param {string} schoolCode
     */
    async create(body, schoolCode) {
      const input = validateCreateClassInput(body, schoolCode);
      const school = await requireSchool(input.schoolCode);
      const academicYear = await resolveAcademicYearForSchool(
        school.id,
        input.academicYearName,
      );

      let classCode = generateClassCode(input.schoolCode);
      let inserted = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          inserted = await db.one(
            `INSERT INTO classes (
               school_id, academic_year_id, class_code, name, level, section, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, class_code, name, level, section, status,
                       academic_year_id, created_at, updated_at`,
            [
              school.id,
              academicYear.id,
              classCode,
              input.name,
              input.level,
              input.section,
              input.status,
            ],
          );
          break;
        } catch (error) {
          if (isClassNameUniquenessViolation(error)) {
            throw nameConflictError(input.name);
          }
          if (isClassCodeUniquenessViolation(error)) {
            classCode = generateClassCode(input.schoolCode);
            continue;
          }
          throw error;
        }
      }
      if (!inserted) {
        throw createHttpError(500, "Impossible de générer un classCode unique.");
      }

      return mapClassRow({
        ...inserted,
        school_code: school.school_code ?? input.schoolCode,
        academic_year_name: academicYear.name,
        enrollment_count: 0,
      });
    },

    /**
     * @param {unknown} classCodeParam
     * @param {string} schoolCode
     * @param {unknown} body
     */
    async update(classCodeParam, schoolCode, body) {
      const classCode = requireClassCodeParam(classCodeParam);
      const patch = validateUpdateClassInput(body);
      const school = await requireSchool(schoolCode);

      // Lookup scoped to school — 404 without revealing cross-tenant existence.
      const current = await db.one(
        `SELECT cl.*, s.school_code, ay.name AS academic_year_name
         FROM classes cl
         JOIN schools s ON s.id = cl.school_id
         JOIN academic_years ay ON ay.id = cl.academic_year_id
         WHERE cl.class_code = $1 AND cl.school_id = $2
         LIMIT 1`,
        [classCode, school.id],
      );
      if (!current) {
        throw createHttpError(404, "Classe introuvable.");
      }

      const nextName = patch.name ?? current.name;
      const nextLevel = Object.hasOwn(patch, "level") ? patch.level : current.level;
      const nextSection = Object.hasOwn(patch, "section") ? patch.section : current.section;
      const nextStatus = patch.status ?? current.status;

      let updated;
      try {
        updated = await db.one(
          `UPDATE classes
           SET name = $1,
               level = $2,
               section = $3,
               status = $4,
               updated_at = NOW()
           WHERE class_code = $5 AND school_id = $6
           RETURNING id, class_code, name, level, section, status,
                     academic_year_id, created_at, updated_at`,
          [nextName, nextLevel, nextSection, nextStatus, classCode, school.id],
        );
      } catch (error) {
        if (isClassNameUniquenessViolation(error)) {
          throw nameConflictError(nextName);
        }
        throw error;
      }
      if (!updated) {
        throw createHttpError(404, "Classe introuvable.");
      }

      const enrollment = await db.one(
        `SELECT COUNT(*)::int AS enrollment_count
         FROM enrollments
         WHERE class_id = $1 AND status = 'active'`,
        [updated.id],
      );

      return mapClassRow({
        ...updated,
        school_code: current.school_code,
        academic_year_name: current.academic_year_name,
        enrollment_count: enrollment?.enrollment_count ?? 0,
      });
    },
  };
}

module.exports = { createClassesRepository };
