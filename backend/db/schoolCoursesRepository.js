"use strict";

const { assignmentError } = require("../lib/teacherAssignmentsManagement");

function asIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? "").trim();
  if (!text) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString();
}

function asCoefficient(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Projection L1 SchoolCourses : UUID PostgreSQL réels.
 * teacherId = teachers.id du tenant (LEFT JOIN), jamais sc.teacher_id d'un autre établissement.
 * academicYearId = classes.academic_year_id confirmé par academic_years.school_id.
 * Statut canonique : active ⇔ status = 'active' ; tombstone ⇔ status != 'active'
 * (`archived` est la seule autre valeur CHECK).
 */
function mapMobileSyncSchoolCourseRow(row) {
  const status = String(row.status ?? "").trim();
  return {
    id: String(row.id),
    courseCode: row.course_code ?? null,
    classId: String(row.class_id),
    classCode: row.class_code ?? null,
    subjectId: String(row.subject_id),
    subjectCode: row.subject_code ?? null,
    teacherId: row.teacher_id ? String(row.teacher_id) : null,
    teacherCode: row.teacher_code ?? null,
    academicYearId: row.academic_year_id ? String(row.academic_year_id) : null,
    coefficient: asCoefficient(row.coefficient),
    status,
    updatedAt: asIsoTimestamp(row.updated_at),
    tombstone: status !== "active",
  };
}

const SELECT_SCHOOL_COURSE_SYNC = `SELECT sc.id,
                sc.course_code,
                cl.id AS class_id,
                cl.class_code,
                sub.id AS subject_id,
                sub.subject_code,
                t.id AS teacher_id,
                t.teacher_code,
                ay.id AS academic_year_id,
                sc.coefficient,
                sc.status,
                sc.updated_at
         FROM school_courses sc
         JOIN classes cl ON cl.id = sc.class_id
           AND cl.school_id = sc.school_id
         JOIN subjects sub ON sub.id = sc.subject_id
           AND sub.school_id = sc.school_id
         JOIN academic_years ay ON ay.id = cl.academic_year_id
           AND ay.school_id = sc.school_id
         LEFT JOIN teachers t ON t.id = sc.teacher_id
           AND t.school_id = sc.school_id`;

function createSchoolCoursesRepository(db) {
  async function requireSchool(schoolCode) {
    const code = String(schoolCode ?? "").trim().toUpperCase();
    if (!code || code === "*") {
      throw assignmentError(400, "schoolCode établissement requis.", "ASSIGNMENT_SCHOOL_REQUIRED");
    }
    const school = await db.getSchoolByCode(code);
    if (!school) throw assignmentError(404, "Établissement introuvable.", "ASSIGNMENT_SCHOOL_NOT_FOUND");
    return school;
  }

  return {
    /**
     * Keyset L1 : ORDER BY updated_at ASC, id ASC — pas d'OFFSET.
     * School-wide : toutes les lignes (tombstones = status != 'active').
     * Assigned : paires (class_id, subject_id) des affectations actives live.
     * JOIN tenant-strict : school_courses / classes / subjects / academic_years /
     * teachers confirment school_id. Une FK seule ne suffit pas.
     *
     * @param {string} schoolCode
     * @param {{
     *   limit: number,
     *   afterUpdatedAt?: string | Date | null,
     *   afterId?: string | null,
     *   coursePairs?: Array<{ classId: string, subjectId: string }> | null,
     * }} options
     */
    async listForMobileSync(schoolCode, options = {}) {
      const school = await requireSchool(schoolCode);
      const limit = Math.max(1, Number(options.limit) || 1);
      const params = [school.id];
      const conditions = ["sc.school_id = $1"];

      if (Array.isArray(options.coursePairs)) {
        const classIds = [];
        const subjectIds = [];
        for (const pair of options.coursePairs) {
          const classId = String(pair?.classId ?? pair?.class_id ?? "").trim();
          const subjectId = String(pair?.subjectId ?? pair?.subject_id ?? "").trim();
          if (!classId || !subjectId) continue;
          classIds.push(classId);
          subjectIds.push(subjectId);
        }
        if (!classIds.length) {
          return [];
        }
        params.push(classIds);
        const classIdx = params.length;
        params.push(subjectIds);
        const subjectIdx = params.length;
        conditions.push(
          `EXISTS (
             SELECT 1
             FROM unnest($${classIdx}::uuid[], $${subjectIdx}::uuid[]) AS pair(class_id, subject_id)
             WHERE pair.class_id = sc.class_id AND pair.subject_id = sc.subject_id
           )`,
        );
      }

      const afterUpdatedAt = options.afterUpdatedAt ?? null;
      const afterId = options.afterId ? String(options.afterId).trim() : "";
      if (afterUpdatedAt && afterId) {
        params.push(afterUpdatedAt);
        const tsIdx = params.length;
        params.push(afterId);
        const idIdx = params.length;
        conditions.push(
          `(sc.updated_at > $${tsIdx}::timestamptz OR (sc.updated_at = $${tsIdx}::timestamptz AND sc.id > $${idIdx}::uuid))`,
        );
      }

      params.push(limit);
      const rows = await db.all(
        `${SELECT_SCHOOL_COURSE_SYNC}
         WHERE ${conditions.join(" AND ")}
         ORDER BY sc.updated_at ASC, sc.id ASC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(mapMobileSyncSchoolCourseRow);
    },
  };
}

module.exports = {
  createSchoolCoursesRepository,
  mapMobileSyncSchoolCourseRow,
  SELECT_SCHOOL_COURSE_SYNC,
};
