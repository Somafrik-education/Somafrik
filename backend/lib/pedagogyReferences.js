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
    throw createPedagogyError(404, "Cours introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
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

async function assertAcademicYearForWeeklySlot(tx, { schoolId, academicYearId, classAcademicYearId, requireOpen }) {
  const year = await tx.getAcademicYearById(academicYearId);
  if (!year || String(year.school_id) !== String(schoolId)) {
    throw createPedagogyError(
      404,
      "Année académique introuvable pour cet établissement.",
      PEDAGOGY_ERROR.ACADEMIC_YEAR_MISMATCH,
    );
  }
  if (classAcademicYearId && String(year.id) !== String(classAcademicYearId)) {
    throw createPedagogyError(
      409,
      "Année académique incohérente avec la classe du cours.",
      PEDAGOGY_ERROR.ACADEMIC_YEAR_MISMATCH,
    );
  }
  if (requireOpen && isClosedAcademicYearStatus(year.status)) {
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
      "Affectation enseignant active requise pour cette classe et ce cours.",
      PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );
  }

  return { teacher, teacherId: teacher.id };
}

async function requireTeacherWithActiveAssignment(tx, args) {
  const key = asTrimmed(args.teacherKey);
  if (!key) {
    throw createPedagogyError(
      400,
      "Enseignant obligatoire pour un créneau de cours.",
      PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );
  }
  const resolved = await resolveTeacherWithActiveAssignment(tx, args);
  if (!resolved.teacherId || !resolved.teacher) {
    throw createPedagogyError(
      400,
      "Enseignant obligatoire pour un créneau de cours.",
      PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );
  }
  const status = String(resolved.teacher.status ?? "active").toLowerCase();
  if (status !== "active") {
    throw createPedagogyError(
      409,
      "L'enseignant n'est pas actif.",
      PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );
  }
  return resolved;
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
  if (
    /non validée|non validee|évaluation publiée|evaluation publiee|évaluation inactive|pas de nouvelle saisie/i.test(
      message,
    ) &&
    statusCode < 500
  ) {
    return createPedagogyError(statusCode === 400 ? 409 : statusCode, message, PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED);
  }
  if (/élève introuvable|eleve introuvable|non inscrit|hors classe/i.test(message) && statusCode < 500) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED);
  }
  if (/période|period|term/i.test(message) && statusCode === 404) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.PERIOD_NOT_FOUND);
  }
  if (error?.code === "23P01" || /exclusion constraint|no_class_overlap|no_teacher_overlap/i.test(message)) {
    return createPedagogyError(409, "Conflit d'emploi du temps.", PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);
  }
  if (/année scolaire fermée|academic year/i.test(message)) {
    return createPedagogyError(statusCode, message, PEDAGOGY_ERROR.ACADEMIC_YEAR_CLOSED);
  }
  if (/affectation|non affecté|hors classe affectée/i.test(message) && statusCode === 403) {
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
  requireTeacherWithActiveAssignment,
  assertAcademicYearForWeeklySlot,
  mapPedagogyPersistenceError,
};
