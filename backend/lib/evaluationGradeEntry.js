"use strict";

const {
  toEvaluationStatus,
  isPublishedEvaluationStatus,
  evaluationStatusAllowsGradeWrite,
} = require("./gradesCanonical");
const { createPedagogyError, PEDAGOGY_ERROR } = require("./pedagogyManagement");
const { PERMISSION_DENIED } = require("../services/rbacService");

function evaluationIsActive(evaluation) {
  return evaluation?.active !== false && evaluation?.active !== 0;
}

/**
 * NOTES-P1 : une note est acceptée sur brouillon / ouverte / validée (locked).
 * Publiée, annulée ou inactive → 409. La validation direction n'est plus un prérequis de saisie.
 */
function assertEvaluationAllowsGradeEntry(evaluation) {
  if (!evaluation) {
    throw createPedagogyError(404, "Évaluation introuvable.", PEDAGOGY_ERROR.EVALUATION_NOT_FOUND);
  }
  const canonical = toEvaluationStatus(evaluation.status, "");
  if (!evaluationIsActive(evaluation) || canonical === "archived") {
    throw createPedagogyError(
      409,
      "Évaluation inactive ou annulée : saisie des notes refusée.",
      PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED,
    );
  }
  if (isPublishedEvaluationStatus(evaluation.status) || canonical === "published") {
    throw createPedagogyError(
      409,
      "Évaluation publiée : pas de nouvelle saisie.",
      PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED,
    );
  }
  if (!evaluationStatusAllowsGradeWrite(evaluation.status, evaluation.active)) {
    throw createPedagogyError(
      409,
      "Évaluation non saisissable : saisie des notes refusée.",
      PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED,
    );
  }
}

function assertStudentEnrolledInEvaluationClass(student, evaluation) {
  if (!student) {
    throw createPedagogyError(404, "Élève introuvable.", PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED);
  }
  const studentClassId = String(student.class_id ?? student.classId ?? "").trim();
  const evaluationClassId = String(evaluation?.class_id ?? evaluation?.classId ?? "").trim();
  if (!studentClassId || !evaluationClassId || studentClassId !== evaluationClassId) {
    throw createPedagogyError(
      409,
      "Élève non inscrit dans la classe de l'évaluation.",
      PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED,
    );
  }
}

function findStateEvaluation(state, evaluationId) {
  const key = String(evaluationId ?? "").trim();
  if (!key) return null;
  return (state?.evaluations ?? []).find(
    (row) => String(row.id ?? "") === key || String(row.publicId ?? "") === key || String(row.pgId ?? "") === key,
  );
}

function isTeacherPrincipal(principal) {
  const role = String(principal?.role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return role === "enseignant" || role === "teacher" || role.includes("enseignant") || role.includes("teacher");
}

function principalHasToken(principal, token) {
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  return permissions.some((item) => String(item ?? "").trim() === token);
}

function throwPermissionDenied(message) {
  const error = createPedagogyError(403, message, PERMISSION_DENIED);
  error.code = PERMISSION_DENIED;
  throw error;
}

/**
 * CREATE pour une première saisie, UPDATE pour modifier une note existante.
 * ALL_PRIVILEGES court-circuite (direction / superadmin déjà hors isTeacherPrincipal).
 */
function assertTeacherGradeMutationPermission(principal, existingGrade) {
  if (!isTeacherPrincipal(principal)) return;
  if (principalHasToken(principal, "ALL_PRIVILEGES")) return;
  if (existingGrade) {
    if (!principalHasToken(principal, "Notes:UPDATE")) {
      throwPermissionDenied("Permission insuffisante pour modifier une note.");
    }
    return;
  }
  if (!principalHasToken(principal, "Notes:CREATE")) {
    throwPermissionDenied("Permission insuffisante pour saisir une note.");
  }
}

/**
 * Un enseignant peut créer une évaluation, pas la valider (Préfet / administration).
 */
function assertTeacherCannotValidateEvaluation(principal, nextStatus) {
  if (!isTeacherPrincipal(principal)) return;
  const canonical = toEvaluationStatus(nextStatus, "");
  if (canonical === "locked" || canonical === "published") {
    throw createPedagogyError(
      403,
      "Validation réservée au préfet ou à l'administration.",
      PEDAGOGY_ERROR.EVALUATION_VALIDATION_FORBIDDEN,
    );
  }
}

module.exports = {
  assertEvaluationAllowsGradeEntry,
  assertStudentEnrolledInEvaluationClass,
  assertTeacherCannotValidateEvaluation,
  assertTeacherGradeMutationPermission,
  findStateEvaluation,
  isTeacherPrincipal,
};
