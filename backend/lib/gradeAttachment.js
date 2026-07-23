/**
 * HOTFIX-SYNC-04 — Rattachement / erreurs métier notes (grades).
 * Codes stables pour syncAck.rejected — pas de « Erreur interne Somafrik » opaque.
 */

function gradeError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const GradeErrors = {
  EVALUATION_MISSING: (evaluationId) =>
    gradeError(
      "GRADE_ATTACHMENT_EVALUATION",
      `Évaluation introuvable pour la note${evaluationId ? ` (${evaluationId})` : ""}`,
    ),
  EVALUATION_REQUIRED: () =>
    gradeError("GRADE_ATTACHMENT_EVALUATION", "evaluation_id obligatoire pour une note"),
  STUDENT_MISSING: (studentId) =>
    gradeError(
      "GRADE_ATTACHMENT_STUDENT",
      `Élève introuvable pour la note${studentId ? ` (${studentId})` : ""}`,
    ),
  STUDENT_SCHOOL_MISMATCH: () =>
    gradeError(
      "GRADE_ATTACHMENT_STUDENT",
      "L'élève et l'évaluation doivent appartenir au même établissement.",
    ),
  TEACHER_MISSING: () =>
    gradeError("GRADE_ATTACHMENT_TEACHER", "Enseignant introuvable pour la note"),
  VERSION_CONFLICT: (message) =>
    gradeError(
      "GRADE_VERSION_CONFLICT",
      message ||
        "La note a été modifiée par un autre utilisateur. Rechargez la page avant de réenregistrer.",
      409,
    ),
  DUPLICATE: () =>
    gradeError("GRADE_DUPLICATE", "Une note existe déjà pour cet élève et cette évaluation.", 409),
  CONTRACT: (message) =>
    gradeError("GRADE_CONTRACT", message || "Note invalide (statut / score incohérents)"),
  ACCESS_DENIED: (message) =>
    gradeError("GRADE_ACCESS_DENIED", message || "Accès refusé pour cette note.", 403),
  SYNC_FAILED: (message) =>
    gradeError("GRADE_SYNC_FAILED", message || "Échec de synchronisation de la note"),
};

/**
 * Mappe une erreur PG / runtime vers un code métier GRADE_*.
 * Ne laisse remonter une 500 que pour les pannes infra non classifiables.
 */
function mapGradeSyncError(error) {
  if (!error) {
    return GradeErrors.SYNC_FAILED("Échec de synchronisation de la note");
  }
  if (error.code && String(error.code).startsWith("GRADE_")) {
    return error;
  }
  if (error.statusCode === 409 || /modifiée par un autre utilisateur/i.test(error.message ?? "")) {
    return GradeErrors.VERSION_CONFLICT(error.message);
  }

  const pgCode = String(error.code ?? "");
  const detail = `${error.message ?? ""} ${error.detail ?? ""} ${error.constraint ?? ""}`;

  if (pgCode === "23505" || /duplicate key|unique/i.test(detail)) {
    return GradeErrors.DUPLICATE();
  }
  if (pgCode === "23514" || /grades_status_score_coherence|grades_score|check constraint/i.test(detail)) {
    return GradeErrors.CONTRACT(error.message);
  }
  if (pgCode === "23503" || /foreign key/i.test(detail)) {
    if (/evaluation/i.test(detail)) return GradeErrors.EVALUATION_MISSING();
    if (/student/i.test(detail)) return GradeErrors.STUDENT_MISSING();
    if (/teacher/i.test(detail)) return GradeErrors.TEACHER_MISSING();
    return GradeErrors.SYNC_FAILED(error.message);
  }

  // Erreur métier déjà typée (statusCode 4xx) — conserver le message, code générique si absent.
  if (error.statusCode && Number(error.statusCode) < 500) {
    const wrapped = gradeError(
      error.code || "GRADE_SYNC_FAILED",
      error.message || "Échec de synchronisation de la note",
      error.statusCode,
    );
    return wrapped;
  }

  // Panne SQL / runtime dans la sync ligne : rester en rejet métier (pas 500 globale).
  return GradeErrors.SYNC_FAILED(error.message || "Échec de synchronisation de la note");
}

module.exports = {
  gradeError,
  GradeErrors,
  mapGradeSyncError,
};
