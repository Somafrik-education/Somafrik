"use strict";

const {
  assignmentError,
  validateAssignmentInput,
} = require("../lib/teacherAssignmentsManagement");
const { assignmentAuditScope, writeTransactionalAudit } = require("../lib/teacherTransactionalAudit");
const { isTeacherAssignmentsActiveUniquenessViolation } = require("../lib/teacherAssignmentsUniqueness");

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
           AND COALESCE(u.status, 'active') = 'active'
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
    if (!teacher) throw assignmentError(404, "Enseignant introuvable.", "ASSIGNMENT_TEACHER_NOT_FOUND");
    if (!schoolClass) throw assignmentError(404, "Classe introuvable.", "ASSIGNMENT_CLASS_NOT_FOUND");
    if (!subject) throw assignmentError(404, "Matière introuvable.", "ASSIGNMENT_SUBJECT_NOT_FOUND");
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
      const sameTeacher =
        String(conflict.teacher_code ?? "") === String(refs.teacher.teacher_code ?? "");
      throw assignmentError(
        409,
        sameTeacher
          ? "Cette affectation existe déjà pour cet enseignant."
          : "Ce cours est déjà affecté à un enseignant pour cette classe.",
        sameTeacher ? "TEACHER_ASSIGNMENT_ALREADY_EXISTS" : "ASSIGNMENT_COURSE_CONFLICT",
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

    async create(body, schoolCode, principal = null, auditMeta = null) {
      const school = await requireSchool(schoolCode);
      const input = validateAssignmentInput(body);
      const wantsAudit = Boolean(principal || auditMeta);
      return db.withTransaction(async (tx) => {
        const scope = wantsAudit ? assignmentAuditScope(db, tx) : tx;
        await scope.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `teacher-assignment:${school.id}`,
        ]);
        const refs = await resolveReferences(scope, school, input);
        await assertCourseAvailable(scope, school.id, refs);
        let row;
        try {
          row = await scope.one(
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
        } catch (error) {
          if (isTeacherAssignmentsActiveUniquenessViolation(error)) {
            throw assignmentError(
              409,
              "Cette affectation existe déjà pour cet enseignant.",
              "TEACHER_ASSIGNMENT_ALREADY_EXISTS",
            );
          }
          throw error;
        }
        const created = mapAssignment(await requireCurrent(row.id, school.id, scope));
        if (wantsAudit) {
          await writeTransactionalAudit(scope, tx, {
            principal: principal ?? {},
            auditMeta: auditMeta ?? {},
            action: "create_teacher_assignment",
            entityType: "teacher_assignment",
            entityId: created.id,
            oldValue: null,
            newValue: {
              teacherCode: created.teacherCode,
              classCode: created.classCode,
              subjectCode: created.subjectCode,
              schoolCode: school.school_code ?? schoolCode,
            },
            schoolCode: school.school_code ?? schoolCode,
          });
        }
        return created;
      });
    },

    async update(assignmentId, body, schoolCode, principal = null, auditMeta = null) {
      const school = await requireSchool(schoolCode);
      const input = validateAssignmentInput(body, { partial: true });
      const wantsAudit = Boolean(principal || auditMeta);
      return db.withTransaction(async (tx) => {
        const scope = wantsAudit ? assignmentAuditScope(db, tx) : tx;
        await scope.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `teacher-assignment:${school.id}`,
        ]);
        const current = await requireCurrent(assignmentId, school.id, scope);
        const refs = await resolveReferences(scope, school, input, current);
        await assertCourseAvailable(scope, school.id, refs, String(assignmentId));
        try {
          await scope.one(
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
        } catch (error) {
          if (isTeacherAssignmentsActiveUniquenessViolation(error)) {
            throw assignmentError(
              409,
              "Cette affectation existe déjà pour cet enseignant.",
              "TEACHER_ASSIGNMENT_ALREADY_EXISTS",
            );
          }
          throw error;
        }
        const updated = mapAssignment(await requireCurrent(assignmentId, school.id, scope));
        if (wantsAudit) {
          await writeTransactionalAudit(scope, tx, {
            principal: principal ?? {},
            auditMeta: auditMeta ?? {},
            action: "update_teacher_assignment",
            entityType: "teacher_assignment",
            entityId: updated.id,
            oldValue: { teacherCode: current.teacher_code, classCode: current.class_code, subjectCode: current.subject_code },
            newValue: {
              teacherCode: updated.teacherCode,
              classCode: updated.classCode,
              subjectCode: updated.subjectCode,
              schoolCode: school.school_code ?? schoolCode,
            },
            schoolCode: school.school_code ?? schoolCode,
          });
        }
        return updated;
      });
    },

    async remove(assignmentId, schoolCode, principal = null, auditMeta = null) {
      const school = await requireSchool(schoolCode);
      const wantsAudit = Boolean(principal || auditMeta);
      const run = async (tx) => {
        const scope = wantsAudit ? assignmentAuditScope(db, tx) : tx;
        await requireCurrent(assignmentId, school.id, scope);
        const row = await scope.one(
          `UPDATE teacher_assignments SET status = 'deleted', updated_at = NOW()
           WHERE id::text = $1 AND school_id = $2 AND status = 'active' RETURNING id`,
          [String(assignmentId), school.id],
        );
        if (!row) throw assignmentError(404, "Affectation introuvable.", "ASSIGNMENT_NOT_FOUND");
        const result = { id: row.id, deleted: true };
        if (wantsAudit) {
          await writeTransactionalAudit(scope, tx, {
            principal: principal ?? {},
            auditMeta: auditMeta ?? {},
            action: "delete_teacher_assignment",
            entityType: "teacher_assignment",
            entityId: result.id,
            oldValue: { id: result.id, status: "active" },
            newValue: { id: result.id, deleted: true, schoolCode: school.school_code ?? schoolCode },
            schoolCode: school.school_code ?? schoolCode,
          });
        }
        return result;
      };
      if (typeof db.withTransaction === "function") {
        return db.withTransaction(run);
      }
      return run(db);
    },
  };
}

module.exports = { createTeacherAssignmentsRepository, mapAssignment, SELECT_ASSIGNMENT };
