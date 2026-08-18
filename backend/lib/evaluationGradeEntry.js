"use strict";

const { toEvaluationStatus, isValidatedEvaluationStatus, isPublishedEvaluationStatus } = require("./gradesCanonical");
const { createPedagogyError, PEDAGOGY_ERROR } = require("./pedagogyManagement");

function evaluationIsActive(evaluation) {
  return evaluation?.active !== false && evaluation?.active !== 0;
}

/**
 * Garde métier P0 : une note n'est acceptée que si l'évaluation PostgreSQL est Validée (`locked`).
 * Ne jamais comparer l'UI « Validée » directement à la colonne PG.
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
  if (!isValidatedEvaluationStatus(evaluation.status)) {
    throw createPedagogyError(
      409,
      "Évaluation non validée : saisie des notes refusée.",
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
  findStateEvaluation,
  isTeacherPrincipal,
};
