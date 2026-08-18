/**
 * HOTFIX-SYNC-02 — Rattachement évaluation → PostgreSQL.
 * Erreurs structurées et résolution déterministe (pas de « Classe ou matiere » opaque).
 */

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function attachmentError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

const ERRORS = {
  SCHOOL_MISSING: (schoolCode) =>
    attachmentError(
      "EVAL_ATTACHMENT_SCHOOL",
      `Etablissement introuvable pour l'évaluation${schoolCode ? ` (${schoolCode})` : ""}`,
    ),
  CLASS_MISSING: (className) =>
    attachmentError(
      "EVAL_ATTACHMENT_CLASS",
      `Classe introuvable pour l'évaluation${className ? ` (« ${className} »)` : ""}`,
    ),
  SUBJECT_MISSING: (subjectName) =>
    attachmentError(
      "EVAL_ATTACHMENT_SUBJECT",
      `Cours introuvable pour l'évaluation${subjectName ? ` (« ${subjectName} »)` : ""}`,
    ),
  YEAR_MISSING: () =>
    attachmentError(
      "EVAL_ATTACHMENT_YEAR",
      "Annee scolaire introuvable pour l'évaluation",
    ),
  TERM_MISSING: (periodName) =>
    attachmentError(
      "EVAL_ATTACHMENT_TERM",
      `Période introuvable pour l'évaluation${periodName ? ` (« ${periodName} »)` : ""}`,
    ),
  CLASS_NAME_REQUIRED: () =>
    attachmentError("EVAL_ATTACHMENT_CLASS", "Classe obligatoire pour l'évaluation"),
  SUBJECT_NAME_REQUIRED: () =>
    attachmentError("EVAL_ATTACHMENT_SUBJECT", "Cours obligatoire pour l'évaluation"),
  TEACHER_REQUIRED: () =>
    attachmentError(
      "EVAL_TEACHER_REQUIRED",
      "Identifiant enseignant (teacherId TEACHERS-*) obligatoire pour l'évaluation",
    ),
  TEACHER_UNRESOLVED: (teacherCode) =>
    attachmentError(
      "EVAL_TEACHER_UNRESOLVED",
      `Enseignant introuvable pour l'évaluation${teacherCode ? ` (« ${teacherCode} »)` : ""}`,
    ),
};

/**
 * Résout les rattachements d'une évaluation legacy via des deps injectables.
 * @param {object} evaluation
 * @param {object} deps
 * @param {{ ensure?: boolean, context?: object }} options
 */
async function resolveEvaluationAttachments(evaluation = {}, deps = {}, options = {}) {
  const ensure = options.ensure !== false;
  const context = options.context ?? {};
  const schoolCode = String(evaluation.schoolCode ?? "").trim().toUpperCase();

  let school = schoolCode ? await deps.getSchoolByCode?.(schoolCode) : null;
  if (!school && ensure && schoolCode) {
    school = await deps.ensureSchool?.(schoolCode, context);
  }
  if (!school) throw ERRORS.SCHOOL_MISSING(schoolCode);

  const className = String(evaluation.className ?? evaluation.class_name ?? "").trim();
  const classId = String(evaluation.classId ?? evaluation.class_id ?? "").trim();
  if (!className && !classId) throw ERRORS.CLASS_NAME_REQUIRED();

  let schoolClass =
    (classId ? await deps.findClassById?.(school.id, classId) : null) ??
    (className ? await deps.findClassByName?.(school.id, className) : null);
  if (!schoolClass && ensure && className) {
    schoolClass = await deps.ensureClass?.(school.id, className, context);
  }
  if (!schoolClass) throw ERRORS.CLASS_MISSING(className || classId);

  const subjectName = String(evaluation.subject ?? evaluation.subjectName ?? "").trim();
  const subjectCode = String(evaluation.subjectCode ?? evaluation.subject_code ?? "").trim();
  const subjectId = String(evaluation.subjectId ?? evaluation.subject_id ?? "").trim();
  if (!subjectName && !subjectCode && !subjectId) throw ERRORS.SUBJECT_NAME_REQUIRED();

  let subject =
    (subjectId ? await deps.findSubjectById?.(school.id, subjectId) : null) ??
    (subjectCode ? await deps.findSubjectByCode?.(school.id, subjectCode) : null) ??
    (subjectName ? await deps.findSubjectByName?.(school.id, subjectName) : null);
  if (!subject && ensure && (subjectName || subjectCode)) {
    subject = await deps.ensureSubject?.(school.id, subjectName || subjectCode, context);
  }
  if (!subject) throw ERRORS.SUBJECT_MISSING(subjectName || subjectCode || subjectId);

  let academicYear = await deps.getCurrentAcademicYear?.(school.id);
  if (!academicYear && ensure) {
    academicYear = await deps.ensureAcademicYear?.(school.id, context);
  }
  if (!academicYear) throw ERRORS.YEAR_MISSING();

  const periodName = String(evaluation.period ?? "Trimestre 1").trim() || "Trimestre 1";
  let term;
  if (ensure) {
    term = await deps.ensureTerm?.(academicYear.id, periodName);
  } else {
    term = await deps.findTermByName?.(academicYear.id, periodName);
    if (!term) throw ERRORS.TERM_MISSING(periodName);
  }

  // FIX V2.1 IDENTITY §5.2 — lookup exact → matérialisation exacte → refus structuré.
  // Interdit : findAnyTeacher, ORDER BY created_at, choix par user_id seul.
  const teacherCode = String(evaluation.teacherId ?? evaluation.teacher_code ?? "").trim();
  const requireTeacher = options.requireTeacher === true;

  let teacher = null;
  if (!teacherCode) {
    if (requireTeacher) throw ERRORS.TEACHER_REQUIRED();
  } else {
    teacher = (await deps.findTeacherByCode?.(school.id, teacherCode)) ?? null;

    if (!teacher && ensure && deps.ensureTeacher) {
      teacher = (await deps.ensureTeacher(school.id, teacherCode, context)) ?? null;
    }

    // Aide limitée : même teacher_code explicite + affectation active (pas de filet « n'importe qui »).
    if (!teacher && ensure && deps.findTeacherByExactAssignment && teacherCode) {
      teacher =
        (await deps.findTeacherByExactAssignment(
          school.id,
          schoolClass.id,
          subject.id,
          teacherCode,
          context,
        )) ?? null;
    }

    if (!teacher) throw ERRORS.TEACHER_UNRESOLVED(teacherCode);
  }

  return {
    school,
    schoolClass,
    subject,
    academicYear,
    term,
    teacher,
    periodName,
    schoolCode,
  };
}

function matchByNormalizedName(rows, name) {
  const target = normalizeText(name);
  if (!target) return null;
  return (
    (rows ?? []).find((row) => normalizeText(row.name ?? row.title ?? "") === target) ?? null
  );
}

module.exports = {
  normalizeText,
  attachmentError,
  ERRORS,
  resolveEvaluationAttachments,
  matchByNormalizedName,
};
