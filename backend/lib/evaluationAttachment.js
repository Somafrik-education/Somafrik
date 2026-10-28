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
  CLASS_AMBIGUOUS: (className, count) => {
    const error = attachmentError(
      "EVAL_ATTACHMENT_CLASS_AMBIGUOUS",
      `Nom de classe ambigu pour l'évaluation (« ${className} » désigne ${count} classes) : préciser classId ou classCode.`,
    );
    error.statusCode = 409;
    return error;
  },
  CLASS_CONFLICT: () =>
    attachmentError(
      "EVAL_ATTACHMENT_CLASS_CONFLICT",
      "Identifiants de classe contradictoires pour l'évaluation (classId, classCode et className doivent désigner la même classe).",
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
 * MONO-FIX-A4 — identité de classe d'une évaluation, déterministe et sans repli.
 *
 * Priorité : classId, puis classCode, puis className.
 *   - classId / classCode fournis : recherche EXACTE dans l'établissement du
 *     principal ; introuvable ⇒ refus (jamais de repli sur le nom) ;
 *   - critères fournis ensemble : ils doivent désigner la même classe, nom
 *     compris (accents et casse ignorés) ; sinon EVAL_ATTACHMENT_CLASS_CONFLICT ;
 *   - className seul : accepté seulement s'il désigne une seule classe de
 *     l'établissement ; plusieurs homonymes ⇒ restriction à l'année scolaire
 *     ouverte ; toujours plusieurs (ou aucun) ⇒ EVAL_ATTACHMENT_CLASS_AMBIGUOUS ;
 *   - ensure (import historique uniquement) : création par nom si aucun résultat.
 * Une classe d'un autre établissement n'est jamais trouvée (même refus qu'une
 * classe inexistante, aucune fuite).
 */
async function resolveEvaluationClass(evaluation, school, deps, { ensure, context }) {
  const className = String(evaluation.className ?? evaluation.class_name ?? "").trim();
  const classId = String(evaluation.classId ?? evaluation.class_id ?? "").trim();
  const classCode = String(evaluation.classCode ?? evaluation.class_code ?? "").trim();
  if (!className && !classId && !classCode) throw ERRORS.CLASS_NAME_REQUIRED();

  let byId = null;
  if (classId) {
    byId = (await deps.findClassById?.(school.id, classId)) ?? null;
    if (!byId) throw ERRORS.CLASS_MISSING(classId);
  }
  let byCode = null;
  if (classCode) {
    byCode = (await deps.findClassByCode?.(school.id, classCode)) ?? null;
    if (!byCode) throw ERRORS.CLASS_MISSING(classCode);
  }
  if (byId && byCode && String(byId.id) !== String(byCode.id)) throw ERRORS.CLASS_CONFLICT();
  const identified = byId ?? byCode;
  if (identified) {
    if (className && normalizeText(identified.name) !== normalizeText(className)) throw ERRORS.CLASS_CONFLICT();
    return identified;
  }

  let candidates = (await deps.findClassesByName?.(school.id, className)) ?? [];
  if (candidates.length > 1) {
    const openYear = await deps.getCurrentAcademicYear?.(school.id);
    const inOpenYear = openYear
      ? candidates.filter((row) => String(row.academic_year_id ?? "") === String(openYear.id))
      : [];
    if (inOpenYear.length !== 1) throw ERRORS.CLASS_AMBIGUOUS(className, candidates.length);
    candidates = inOpenYear;
  }
  if (candidates.length === 1) return candidates[0];
  if (ensure) {
    const created = await deps.ensureClass?.(school.id, className, context);
    if (created) return created;
  }
  throw ERRORS.CLASS_MISSING(className);
}

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

  const schoolClass = await resolveEvaluationClass(evaluation, school, deps, { ensure, context });

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
  resolveEvaluationClass,
  matchByNormalizedName,
};
