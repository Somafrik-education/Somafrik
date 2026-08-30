"use strict";

/**
 * P0 — réconciliation canonique enseignant / cours.
 *
 * ID-CANONICAL-01B : plus de réécriture teacher_code ni legacy_teacher_code.
 * Les affectations actives produisent un school_courses si les FK UUID sont
 * non ambiguës. 0 correspondance → INSERT. >1 ou collision → STOP.
 */

const { generateCourseCode } = require("./pedagogyService");
const {
  TEACHERS_LEGACY_CODE_SCHEMA_SQL,
  ensureTeachersLegacyCodeSchema,
} = require("../db/teachersLegacyCodeSchema");

const CANONICAL_TEACHER_CODE_CONFLICT = "CANONICAL_TEACHER_CODE_CONFLICT";
const CANONICAL_SCHOOL_COURSE_AMBIGUOUS = "CANONICAL_SCHOOL_COURSE_AMBIGUOUS";

function createCanonicalReconcileError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 500;
  if (details) error.details = details;
  return error;
}

function classifyTeacherPublicCode() {
  return { kind: "canonical", sequence: null, canonical: null };
}

/**
 * @param {{ matchingByTeacher: unknown[], matchingByClassSubject: unknown[] }} input
 * @returns {{ action: "insert" | "skip" | "stop", code?: string }}
 */
function decideSchoolCourseMaterialization({ matchingByTeacher = [], matchingByClassSubject = [] }) {
  if (matchingByTeacher.length > 1) {
    return { action: "stop", code: CANONICAL_SCHOOL_COURSE_AMBIGUOUS };
  }
  if (matchingByTeacher.length === 1) {
    return { action: "skip" };
  }
  if (matchingByClassSubject.length > 0) {
    return { action: "stop", code: CANONICAL_SCHOOL_COURSE_AMBIGUOUS };
  }
  return { action: "insert" };
}

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

async function all(db, sql, params) {
  if (typeof db.all === "function") return db.all(sql, params);
  return rowsOf(await db.query(sql, params));
}

async function one(db, sql, params) {
  if (typeof db.one === "function") return db.one(sql, params);
  return rowsOf(await db.query(sql, params))[0] ?? null;
}

async function exec(db, sql, params) {
  return db.query(sql, params);
}

async function ensureTeacherCourseCanonicalSchema(db) {
  await ensureTeachersLegacyCodeSchema(db);
}

async function reconcileTeacherPublicCodes() {
  return {
    rewritten: 0,
    rewrittenIds: [],
    before: [],
    after: [],
  };
}

function assignmentRefsAreCanonical(row) {
  if (!row.teacher_id || !row.class_id || !row.subject_id || !row.academic_year_id || !row.school_id) {
    return false;
  }
  if (!row.teacher_row_id || !row.class_row_id || !row.subject_row_id || !row.year_row_id || !row.school_code) {
    return false;
  }
  if (String(row.teacher_school_id) !== String(row.school_id)) return false;
  if (String(row.class_school_id) !== String(row.school_id)) return false;
  if (String(row.subject_school_id) !== String(row.school_id)) return false;
  if (String(row.year_school_id) !== String(row.school_id)) return false;
  if (String(row.class_academic_year_id) !== String(row.academic_year_id)) return false;
  const teacherStatus = String(row.teacher_status ?? "active").toLowerCase();
  if (["deleted", "archived"].includes(teacherStatus)) return false;
  return true;
}

async function materializeSchoolCoursesFromAssignments(db) {
  const assignments = await all(
    db,
    `SELECT ta.id,
            ta.school_id,
            ta.teacher_id,
            ta.class_id,
            ta.subject_id,
            ta.academic_year_id,
            t.id AS teacher_row_id,
            t.school_id AS teacher_school_id,
            t.status AS teacher_status,
            t.teacher_code,
            c.id AS class_row_id,
            c.school_id AS class_school_id,
            c.academic_year_id AS class_academic_year_id,
            sub.id AS subject_row_id,
            sub.school_id AS subject_school_id,
            sub.coefficient,
            ay.id AS year_row_id,
            ay.school_id AS year_school_id,
            s.school_code
     FROM teacher_assignments ta
     LEFT JOIN teachers t ON t.id = ta.teacher_id
     LEFT JOIN classes c ON c.id = ta.class_id
     LEFT JOIN subjects sub ON sub.id = ta.subject_id
     LEFT JOIN academic_years ay ON ay.id = ta.academic_year_id
     LEFT JOIN schools s ON s.id = ta.school_id
     WHERE ta.status = 'active'
     ORDER BY ta.created_at, ta.id`,
  );

  const codesBySchool = new Map();
  async function codesForSchool(schoolId) {
    if (!codesBySchool.has(schoolId)) {
      const rows = await all(db, `SELECT course_code FROM school_courses WHERE school_id = $1`, [schoolId]);
      codesBySchool.set(schoolId, rows);
    }
    return codesBySchool.get(schoolId);
  }

  let created = 0;
  const createdIds = [];

  for (const row of assignments) {
    if (!assignmentRefsAreCanonical(row)) {
      throw createCanonicalReconcileError(
        CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
        "Affectation active avec références non canoniques ou ambiguës — aucun school_course silencieux.",
        {
          assignmentId: row.id,
          schoolId: row.school_id,
          teacherId: row.teacher_id,
          classId: row.class_id,
          subjectId: row.subject_id,
          academicYearId: row.academic_year_id,
        },
      );
    }

    const matchingByTeacher = await all(
      db,
      `SELECT id, teacher_id
       FROM school_courses
       WHERE school_id = $1
         AND class_id = $2
         AND subject_id = $3
         AND teacher_id = $4
         AND status = 'active'`,
      [row.school_id, row.class_id, row.subject_id, row.teacher_id],
    );
    const matchingByClassSubject = await all(
      db,
      `SELECT id, teacher_id
       FROM school_courses
       WHERE school_id = $1
         AND class_id = $2
         AND subject_id = $3
         AND status = 'active'`,
      [row.school_id, row.class_id, row.subject_id],
    );

    const decision = decideSchoolCourseMaterialization({ matchingByTeacher, matchingByClassSubject });
    if (decision.action === "stop") {
      throw createCanonicalReconcileError(
        CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
        "Plusieurs school_courses actifs ou collision classe+matière — aucun choix silencieux.",
        {
          assignmentId: row.id,
          schoolId: row.school_id,
          teacherId: row.teacher_id,
          classId: row.class_id,
          subjectId: row.subject_id,
          matchingByTeacher: matchingByTeacher.map((item) => item.id),
          matchingByClassSubject: matchingByClassSubject.map((item) => ({
            id: item.id,
            teacherId: item.teacher_id,
          })),
        },
      );
    }
    if (decision.action === "skip") {
      continue;
    }

    const existingCodes = await codesForSchool(row.school_id);
    const courseCode = generateCourseCode(row.school_code, existingCodes);
    const teacherPublicId = String(row.teacher_code ?? "").trim();
    const coefficient = Number(row.coefficient ?? 1) > 0 ? Number(row.coefficient) : 1;

    const inserted = await one(
      db,
      `INSERT INTO school_courses
         (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status, legacy_json_id, profile_payload)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $5, $7::jsonb)
       RETURNING id`,
      [
        row.school_id,
        row.class_id,
        row.subject_id,
        row.teacher_id,
        courseCode,
        coefficient,
        JSON.stringify({ teacherId: teacherPublicId }),
      ],
    );
    existingCodes.push({ course_code: courseCode });
    created += 1;
    createdIds.push(inserted.id);
  }

  return { created, createdIds };
}

async function reconcileTeacherCourseCanonical(db) {
  await exec(db, `SELECT pg_advisory_xact_lock(hashtext('teacher-course-canonical-reconcile'))`);
  const teachers = await reconcileTeacherPublicCodes(db);
  const courses = await materializeSchoolCoursesFromAssignments(db);
  return {
    teachersRewritten: teachers.rewritten,
    teacherIdsRewritten: teachers.rewrittenIds,
    teachersBefore: teachers.before,
    teachersAfter: teachers.after,
    schoolCoursesCreated: courses.created,
    schoolCourseIdsCreated: courses.createdIds,
  };
}

async function ensureTeacherCourseCanonicalReconcile(db, logger = console) {
  await ensureTeacherCourseCanonicalSchema(db);
  const run = async (tx) => reconcileTeacherCourseCanonical(tx ?? db);
  const report =
    typeof db.withTransaction === "function" ? await db.withTransaction(run) : await run(db);
  if (report.teachersRewritten || report.schoolCoursesCreated) {
    logger.info?.(
      `[teacher-course-canonical] rewritten=${report.teachersRewritten} school_courses=${report.schoolCoursesCreated}`,
    );
  }
  return report;
}

module.exports = {
  CANONICAL_TEACHER_CODE_CONFLICT,
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
  TEACHERS_LEGACY_CODE_SCHEMA_SQL,
  classifyTeacherPublicCode,
  decideSchoolCourseMaterialization,
  createCanonicalReconcileError,
  ensureTeacherCourseCanonicalSchema,
  reconcileTeacherCourseCanonical,
  ensureTeacherCourseCanonicalReconcile,
};
