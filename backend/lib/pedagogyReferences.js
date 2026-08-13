"use strict";

const {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
} = require("./pedagogyManagement");

function isClosedAcademicYearStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "closed" || normalized === "archived" || normalized === "fermee" || normalized === "fermé";
}

async function resolveCanonicalClass(tx, schoolId, className) {
  const klass = await tx.findClass(schoolId, className);
  if (!klass) {
    throw createPedagogyError(404, "Classe introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
  }
  return klass;
}

async function resolveCanonicalSubject(tx, schoolId, subjectName) {
  const subject = await tx.findSubject(schoolId, subjectName);
  if (!subject) {
    throw createPedagogyError(404, "Matière introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
  }
  return subject;
}

async function assertOpenAcademicYearForClass(tx, klass) {
  const year = await tx.getAcademicYearById(klass.academic_year_id);
  if (!year) {
    throw createPedagogyError(404, "Année scolaire introuvable.", PEDAGOGY_ERROR.ACADEMIC_YEAR_CLOSED);
  }
  if (isClosedAcademicYearStatus(year.status)) {
    throw createPedagogyError(409, "Année scolaire fermée.", PEDAGOGY_ERROR.ACADEMIC_YEAR_CLOSED);
  }
  return year;
}

async function resolveCanonicalPeriod(tx, academicYearId, periodName) {
  const name = asTrimmed(periodName);
  if (!name) return null;
  const term = await tx.findTermByName(academicYearId, name);
  if (!term) {
    throw createPedagogyError(404, "Période introuvable.", PEDAGOGY_ERROR.PERIOD_NOT_FOUND);
  }
  return term;
}

/**
 * Lorsqu'un enseignant est fourni, exige une affectation active compatible
 * (classe + matière + année scolaire de la classe).
 */
async function resolveTeacherWithActiveAssignment(
  tx,
  { schoolId, teacherKey, classId, subjectId, academicYearId },
) {
  const key = asTrimmed(teacherKey);
  if (!key) {
    return { teacher: null, teacherId: null };
  }

  const teacher = await tx.findTeacher(schoolId, key);
  if (!teacher) {
    throw createPedagogyError(404, "Enseignant introuvable.");
  }

  const assignment = await tx.findActiveTeacherAssignment({
    schoolId,
    teacherId: teacher.id,
    classId,
    subjectId,
    academicYearId,
  });
  if (!assignment) {
    throw createPedagogyError(
      403,
      "Affectation enseignant active requise pour cette classe et matière.",
      PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );
  }

  return { teacher, teacherId: teacher.id };
}

function mapPedagogyPersistenceError(error) {
  if (error?.code && Object.values(PEDAGOGY_ERROR).includes(error.code)) {
    return error;
  }

  const message = String(error?.message ?? "");
  const statusCode = Number(error?.statusCode ?? 500);

  if (/hors barème|score|note invalide|coefficient|max_score/i.test(message) && statusCode < 500) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.GRADE_INVALID);
  }
  if (/élève introuvable|eleve introuvable|non inscrit|hors classe/i.test(message) && statusCode < 500) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED);
  }
  if (/période|period|term/i.test(message) && statusCode === 404) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.PERIOD_NOT_FOUND);
  }
  if (/année scolaire fermée|academic year/i.test(message)) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.ACADEMIC_YEAR_CLOSED);
  }
  if (/affectation|matière non affectée|hors classe affectée/i.test(message) && statusCode === 403) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);
  }

  return error;
}

module.exports = {
  isClosedAcademicYearStatus,
  resolveCanonicalClass,
  resolveCanonicalSubject,
  assertOpenAcademicYearForClass,
  resolveCanonicalPeriod,
  resolveTeacherWithActiveAssignment,
  mapPedagogyPersistenceError,
};
