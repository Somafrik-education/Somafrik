"use strict";

const { assignmentError } = require("../lib/teacherAssignmentsManagement");
const { formatTimeHm } = require("../lib/planningWeekly");

function asIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? "").trim();
  if (!text) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString();
}

/**
 * Projection L1 CourseSchedules : définition hebdomadaire (dayOfWeek + TIME).
 * Jamais d'occurrences datées. teacherId / roomId = UUID du JOIN tenant, jamais
 * w.teacher_id / w.room_id cross-tenant. Pas de className/subjectName/teacherName.
 * Statuts CHECK : active | cancelled | archived. tombstone ⇔ status != 'active'.
 */
function mapMobileSyncCourseScheduleRow(row) {
  const status = String(row.status ?? "").trim();
  return {
    id: String(row.id),
    schoolCourseId: String(row.school_course_id),
    courseCode: row.course_code ?? null,
    academicYearId: String(row.academic_year_id),
    classId: String(row.class_id),
    classCode: row.class_code ?? null,
    subjectId: String(row.subject_id),
    subjectCode: row.subject_code ?? null,
    teacherId: String(row.teacher_id),
    teacherCode: row.teacher_code ?? null,
    roomId: row.room_id ? String(row.room_id) : null,
    roomCode: row.room_code ?? null,
    dayOfWeek: Number(row.day_of_week),
    startTime: formatTimeHm(row.start_time),
    endTime: formatTimeHm(row.end_time),
    status,
    updatedAt: asIsoTimestamp(row.updated_at),
    tombstone: status !== "active",
  };
}

const SELECT_COURSE_SCHEDULE_SYNC = `SELECT w.id,
                sc.id AS school_course_id,
                sc.course_code,
                ay.id AS academic_year_id,
                c.id AS class_id,
                c.class_code,
                sub.id AS subject_id,
                sub.subject_code,
                t.id AS teacher_id,
                t.teacher_code,
                r.id AS room_id,
                r.room_code,
                w.day_of_week,
                w.start_time,
                w.end_time,
                w.status,
                w.updated_at
         FROM course_schedule_weekly_slots w
         JOIN school_courses sc ON sc.id = w.school_course_id
           AND sc.school_id = w.school_id
         JOIN classes c ON c.id = w.class_id
           AND c.school_id = w.school_id
         JOIN academic_years ay ON ay.id = w.academic_year_id
           AND ay.school_id = w.school_id
         JOIN teachers t ON t.id = w.teacher_id
           AND t.school_id = w.school_id
         JOIN subjects sub ON sub.id = sc.subject_id
           AND sub.school_id = w.school_id
         LEFT JOIN school_rooms r ON r.id = w.room_id
           AND r.school_id = w.school_id`;

function createCourseSchedulesRepository(db) {
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
     * School-wide : toutes les lignes weekly (tombstones cancelled/archived).
     * Assigned : teacher UUID live ET paires (class_id, subject_id) d'affectations.
     *
     * @param {string} schoolCode
     * @param {{
     *   limit: number,
     *   afterUpdatedAt?: string | Date | null,
     *   afterId?: string | null,
     *   teacherIds?: string[] | null,
     *   coursePairs?: Array<{ classId: string, subjectId: string }> | null,
     * }} options
     */
    async listForMobileSync(schoolCode, options = {}) {
      const school = await requireSchool(schoolCode);
      const limit = Math.max(1, Number(options.limit) || 1);
      const params = [school.id];
      const conditions = ["w.school_id = $1"];

      if (Array.isArray(options.teacherIds)) {
        const teacherIds = options.teacherIds.map((id) => String(id ?? "").trim()).filter(Boolean);
        if (!teacherIds.length) return [];
        params.push(teacherIds);
        conditions.push(`t.id = ANY($${params.length}::uuid[])`);
      }

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
        if (!classIds.length) return [];
        params.push(classIds);
        const classIdx = params.length;
        params.push(subjectIds);
        const subjectIdx = params.length;
        conditions.push(
          `EXISTS (
             SELECT 1
             FROM unnest($${classIdx}::uuid[], $${subjectIdx}::uuid[]) AS pair(class_id, subject_id)
             WHERE pair.class_id = w.class_id AND pair.subject_id = sc.subject_id
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
          `(w.updated_at > $${tsIdx}::timestamptz OR (w.updated_at = $${tsIdx}::timestamptz AND w.id > $${idIdx}::uuid))`,
        );
      }

      params.push(limit);
      const rows = await db.all(
        `${SELECT_COURSE_SCHEDULE_SYNC}
         WHERE ${conditions.join(" AND ")}
         ORDER BY w.updated_at ASC, w.id ASC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(mapMobileSyncCourseScheduleRow);
    },
  };
}

module.exports = {
  createCourseSchedulesRepository,
  mapMobileSyncCourseScheduleRow,
  SELECT_COURSE_SCHEDULE_SYNC,
};
