"use strict";

const {
  assignmentError,
  validateAssignmentInput,
} = require("../lib/teacherAssignmentsManagement");

function mapAssignment(row) {
  return {
    id: row.id,
    schoolCode: row.school_code,
    teacherId: row.teacher_code,
    teacherCode: row.teacher_code,
    teacherName: [row.first_name, row.last_name].filter(Boolean).join(" "),
    className: row.class_name,
    classCode: row.class_code,
    subject: row.subject_name,
    course: row.subject_name,
    subjectCode: row.subject_code,
    academicYear: row.academic_year_name,
    assignmentRole: row.assignment_role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_ASSIGNMENT = `SELECT ta.id,
       ta.school_id, ta.teacher_id, ta.class_id, ta.subject_id, ta.academic_year_id,
       ta.assignment_role, ta.status, ta.created_at, ta.updated_at,
       s.school_code, t.teacher_code, u.first_name, u.last_name,
       cl.class_code, cl.name AS class_name,
       sub.subject_code, sub.name AS subject_name,
       ay.name AS academic_year_name
  FROM teacher_assignments ta
  JOIN schools s ON s.id = ta.school_id
  JOIN teachers t ON t.id = ta.teacher_id
  LEFT JOIN users u ON u.id = t.user_id
  JOIN classes cl ON cl.id = ta.class_id
  JOIN subjects sub ON sub.id = ta.subject_id
  JOIN academic_years ay ON ay.id = ta.academic_year_id`;

function createTeacherAssignmentsRepository(db) {
  async function requireSchool(schoolCode) {
    const code = String(schoolCode ?? "").trim().toUpperCase();
    if (!code || code === "*") {
      throw assignmentError(400, "schoolCode établissement requis.", "ASSIGNMENT_SCHOOL_REQUIRED");
    }
    const school = await db.getSchoolByCode(code);
    if (!school) throw assignmentError(404, "Établissement introuvable.", "ASSIGNMENT_SCHOOL_NOT_FOUND");
    return school;
  }

  async function requireCurrent(rowId, schoolId, reader = db) {
    const row = await reader.one(
      `${SELECT_ASSIGNMENT} WHERE ta.id::text = $1 AND ta.school_id = $2 LIMIT 1`,
      [String(rowId ?? "").trim(), schoolId],
    );
    if (!row || row.status !== "active") {
      throw assignmentError(404, "Affectation introuvable.", "ASSIGNMENT_NOT_FOUND");
    }
    return row;
  }

  async function resolveReferences(reader, school, input, current = null) {
    const teacherRef = input.present.teacherCode ? input.teacherCode : current?.teacher_code;
    const classRef = input.present.classRef ? input.classRef : current?.class_code;
    const subjectRef = input.present.subjectRef ? input.subjectRef : current?.subject_code;

    const [teacher, schoolClass, subject] = await Promise.all([
      reader.one(
        `SELECT t.id, t.teacher_code FROM teachers t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.school_id = $1
           AND (t.teacher_code = $2 OR t.id::text = $2 OR u.user_code = $2 OR u.id::text = $2)
           AND COALESCE(t.status, 'active') = 'active'
         LIMIT 1`,
        [school.id, teacherRef],
      ),
      reader.one(
        `SELECT cl.id, cl.class_code, cl.academic_year_id
         FROM classes cl
         WHERE cl.school_id = $1 AND (cl.class_code = $2 OR cl.name = $2)
           AND COALESCE(cl.status, 'active') = 'active'
         LIMIT 1`,
        [school.id, classRef],
      ),
      reader.one(
        `SELECT sub.id, sub.subject_code
         FROM subjects sub
         WHERE sub.school_id = $1 AND (sub.subject_code = $2 OR sub.name = $2)
           AND COALESCE(sub.status, 'active') = 'active'
         LIMIT 1`,
        [school.id, subjectRef],
      ),
    ]);
    if (!teacher) throw assignmentError(400, "Enseignant introuvable.", "ASSIGNMENT_TEACHER_NOT_FOUND");
    if (!schoolClass) throw assignmentError(400, "Classe introuvable.", "ASSIGNMENT_CLASS_NOT_FOUND");
    if (!subject) throw assignmentError(400, "Matière introuvable.", "ASSIGNMENT_SUBJECT_NOT_FOUND");
    return { teacher, schoolClass, subject };
  }

  async function assertCourseAvailable(reader, schoolId, refs, excludeId = null) {
    const conflict = await reader.one(
      `SELECT ta.id, t.teacher_code
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       WHERE ta.school_id = $1 AND ta.class_id = $2 AND ta.subject_id = $3
         AND ta.academic_year_id = $4 AND ta.status = 'active'
         AND ($5::text IS NULL OR ta.id::text <> $5)
       LIMIT 1`,
      [schoolId, refs.schoolClass.id, refs.subject.id, refs.schoolClass.academic_year_id, excludeId],
    );
    if (conflict) {
      throw assignmentError(
        409,
        "Ce cours est déjà affecté à un enseignant pour cette classe.",
        "ASSIGNMENT_COURSE_CONFLICT",
      );
    }
  }

  return {
    async listBySchoolCode(schoolCode) {
      const school = await requireSchool(schoolCode);
      const rows = await db.all(
        `${SELECT_ASSIGNMENT} WHERE ta.school_id = $1 AND ta.status = 'active'
         ORDER BY cl.name, sub.name, t.teacher_code`,
        [school.id],
      );
      return rows.map(mapAssignment);
    },

    async create(body, schoolCode) {
      const school = await requireSchool(schoolCode);
      const input = validateAssignmentInput(body);
      return db.withTransaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `teacher-assignment:${school.id}`,
        ]);
        const refs = await resolveReferences(tx, school, input);
        await assertCourseAvailable(tx, school.id, refs);
        const row = await tx.one(
          `INSERT INTO teacher_assignments (
             school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status
           ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
           RETURNING id`,
          [
            school.id,
            refs.teacher.id,
            refs.schoolClass.id,
            refs.subject.id,
            refs.schoolClass.academic_year_id,
            input.assignmentRole,
          ],
        );
        return mapAssignment(await requireCurrent(row.id, school.id, tx));
      });
    },

    async update(assignmentId, body, schoolCode) {
      const school = await requireSchool(schoolCode);
      const input = validateAssignmentInput(body, { partial: true });
      return db.withTransaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `teacher-assignment:${school.id}`,
        ]);
        const current = await requireCurrent(assignmentId, school.id, tx);
        const refs = await resolveReferences(tx, school, input, current);
        await assertCourseAvailable(tx, school.id, refs, String(assignmentId));
        await tx.one(
          `UPDATE teacher_assignments SET teacher_id = $1, class_id = $2, subject_id = $3,
             academic_year_id = $4, assignment_role = $5, updated_at = NOW()
           WHERE id::text = $6 AND school_id = $7 RETURNING id`,
          [
            refs.teacher.id,
            refs.schoolClass.id,
            refs.subject.id,
            refs.schoolClass.academic_year_id,
            input.present.assignmentRole ? input.assignmentRole : current.assignment_role,
            String(assignmentId),
            school.id,
          ],
        );
        return mapAssignment(await requireCurrent(assignmentId, school.id, tx));
      });
    },

    async remove(assignmentId, schoolCode) {
      const school = await requireSchool(schoolCode);
      await requireCurrent(assignmentId, school.id);
      const row = await db.one(
        `UPDATE teacher_assignments SET status = 'deleted', updated_at = NOW()
         WHERE id::text = $1 AND school_id = $2 AND status = 'active' RETURNING id`,
        [String(assignmentId), school.id],
      );
      if (!row) throw assignmentError(404, "Affectation introuvable.", "ASSIGNMENT_NOT_FOUND");
      return { id: row.id, deleted: true };
    },
  };
}

module.exports = { createTeacherAssignmentsRepository, mapAssignment, SELECT_ASSIGNMENT };
