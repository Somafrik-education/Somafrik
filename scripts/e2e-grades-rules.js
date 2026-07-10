/**
 * Règles métier notes / évaluations (alignées web/src/lib/evaluations.ts + gradeBook.ts).
 */
const { normalize, newId, todayPeriodDate } = require("./e2e-api-helpers");

function resolveTeacherRecordForUser(user, state) {
  if (!user) return null;
  const userId = String(user.id ?? "").trim();
  const identifier = normalize(user.identifier);
  const teachers = state.teachers ?? [];
  return (
    teachers.find((teacher) => {
      if (userId && String(teacher.userId ?? "") === userId) return true;
      if (identifier && normalize(teacher.identifier) === identifier) return true;
      return false;
    }) ?? null
  );
}

function validateGradeValue(value, scale) {
  if (!Number.isFinite(value)) return "La note doit être un nombre.";
  if (value < 0) return "La note ne peut pas être négative.";
  if (value > scale) return `La note ne peut pas dépasser le barème (${scale}).`;
  return null;
}

function teacherCanAccessEvaluation(user, evaluation, state) {
  if (!user) return false;
  const role = normalize(user.role);
  if (role.includes("admin") || role.includes("prefet") || role.includes("proviseur") || role.includes("directeur")) {
    return true;
  }
  if (role.includes("enseignant") || role.includes("teacher")) {
    const teacher = resolveTeacherRecordForUser(user, state);
    const teacherName = teacher
      ? `${String(teacher.firstName ?? "")} ${String(teacher.lastName ?? "")}`.trim()
      : "";
    const userId = String(user.id ?? "").trim();

    if (evaluation.teacherId) {
      if (teacher?.id && String(evaluation.teacherId) === String(teacher.id)) return true;
      const owner = (state.teachers ?? []).find((row) => String(row.id) === String(evaluation.teacherId));
      if (owner && userId && String(owner.userId) === userId) return true;
    }
    if (evaluation.teacherName && teacherName && normalize(evaluation.teacherName) === normalize(teacherName)) {
      return true;
    }

    const assignments = state.assignments ?? [];
    return assignments.some((assignment) => {
      const classOk = normalize(String(assignment.className ?? "")) === normalize(evaluation.className);
      const subjectOk =
        normalize(String(assignment.subject ?? assignment.course ?? "")) === normalize(evaluation.subject);
      if (!classOk || !subjectOk) return false;
      if (teacher?.id && String(assignment.teacherId ?? "") === String(teacher.id)) return true;
      const assignedTeacher = (state.teachers ?? []).find(
        (row) => String(row.id) === String(assignment.teacherId ?? ""),
      );
      return assignedTeacher ? String(assignedTeacher.userId ?? "") === userId : false;
    });
  }
  return false;
}

function createEvaluation(input, author) {
  const now = formatGradeDateTime();
  return {
    ...input,
    id: input.id ?? newId("EVAL"),
    status: input.status ?? "Ouverte",
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy: author?.id,
    history: [
      {
        authorId: author?.id ?? "SYSTEM",
        authorName: authorDisplayName(author),
        action: "evaluation.create",
        newValue: input.title,
        date: now,
      },
    ],
  };
}

function publishEvaluation(evaluation, author) {
  const now = formatGradeDateTime();
  return {
    ...evaluation,
    status: "Publiée",
    updatedAt: now,
    history: [
      ...(evaluation.history ?? []),
      {
        authorId: author?.id ?? "SYSTEM",
        authorName: authorDisplayName(author),
        action: "evaluation.publish",
        date: now,
      },
    ],
  };
}

function validateEvaluationGrades(evaluation, grades, author) {
  const now = formatGradeDateTime();
  const nextGrades = grades.map((grade) => {
    if (grade.evaluationId !== evaluation.id) return grade;
    if (grade.value == null) return grade;
    return {
      ...grade,
      gradeStatus: "Validée",
      validatedBy: author?.id,
      validatedByName: authorDisplayName(author),
      validatedAt: now,
    };
  });
  const nextEvaluation = {
    ...evaluation,
    status: "Validée",
    updatedAt: now,
    history: [
      ...(evaluation.history ?? []),
      {
        authorId: author?.id ?? "SYSTEM",
        authorName: authorDisplayName(author),
        action: "evaluation.validate",
        date: now,
      },
    ],
  };
  return { evaluation: nextEvaluation, grades: nextGrades };
}

function upsertStudentGrade(grades, evaluation, student, input) {
  const studentId = String(student.id ?? "");
  const existingIndex = grades.findIndex(
    (grade) => grade.evaluationId === evaluation.id && grade.studentId === studentId,
  );
  const isAbsence = ["Absente", "Justifiée", "Non justifiée", "Dispensée", "En attente"].includes(
    input.gradeStatus,
  );

  if (!isAbsence && input.value != null) {
    const validationError = validateGradeValue(input.value, evaluation.scale);
    if (validationError) return { grades, error: validationError };
  }

  const now = formatGradeDateTime();
  const base = {
    id: existingIndex >= 0 ? grades[existingIndex].id : newId("NOTE"),
    schoolCode: evaluation.schoolCode,
    studentId,
    studentName: formatStudentName(student),
    evaluationId: evaluation.id,
    subject: evaluation.subject,
    className: evaluation.className,
    period: evaluation.period,
    value: isAbsence ? undefined : input.value,
    scale: evaluation.scale,
    evaluationCoefficient: evaluation.coefficient,
    coefficient: evaluation.coefficient,
    gradeStatus: input.gradeStatus ?? "Saisie",
    authorId: input.author?.id,
    authorName: authorDisplayName(input.author),
    enteredAt: now,
    date: evaluation.date ?? todayPeriodDate(),
    audit: [],
  };

  const next = [...grades];
  if (existingIndex >= 0) next[existingIndex] = base;
  else next.push(base);
  return { grades: next };
}

function gradesToLegacyNotes(grades) {
  return grades.map((grade) => ({
    id: grade.id,
    schoolCode: grade.schoolCode,
    studentId: grade.studentId,
    studentName: grade.studentName,
    subject: grade.subject,
    className: grade.className,
    period: grade.period,
    value: grade.value,
    scale: grade.scale,
    coefficient: grade.coefficient ?? grade.evaluationCoefficient ?? 1,
    evaluationCoefficient: grade.evaluationCoefficient ?? 1,
    evaluationId: grade.evaluationId,
    gradeStatus: grade.gradeStatus,
    date: grade.date,
    authorId: grade.authorId,
    enteredAt: grade.enteredAt,
    validatedBy: grade.validatedBy,
    validatedAt: grade.validatedAt,
    audit: grade.audit ?? [],
  }));
}

function isParentOrStudentRole(role) {
  const key = normalize(role);
  return key.includes("parent") || key.includes("eleve") || key.includes("etudiant");
}

/** Notes visibles côté parent / élève : uniquement évaluations publiées. */
function filterGradesForParentOrStudent(role, notes, evaluations) {
  if (!isParentOrStudentRole(role)) return notes ?? [];
  const publishedEvalIds = new Set(
    (evaluations ?? [])
      .filter((row) => row.active !== false && row.status === "Publiée")
      .map((row) => String(row.id)),
  );
  return (notes ?? []).filter((note) => {
    const evaluationId = String(note.evaluationId ?? "");
    return evaluationId && publishedEvalIds.has(evaluationId);
  });
}

function formatStudentName(student) {
  const first = String(student.firstName ?? "").trim();
  const last = String(student.lastName ?? student.name ?? "").trim();
  return `${first} ${last}`.trim() || String(student.id ?? "Élève");
}

function authorDisplayName(user) {
  if (!user) return undefined;
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.identifier;
}

function formatGradeDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildGradeEntrySession({ state, evaluationInput, studentGrades, author }) {
  const evaluation = createEvaluation(evaluationInput, author);
  if (!teacherCanAccessEvaluation(author, evaluation, state)) {
    return { ok: false, error: "Enseignant non affecté à cette matière / classe." };
  }

  let grades = [];
  for (const entry of studentGrades) {
    const student = (state.students ?? []).find((row) => String(row.id) === String(entry.studentId));
    if (!student) return { ok: false, error: `Élève introuvable: ${entry.studentId}` };
    const result = upsertStudentGrade(grades, evaluation, student, {
      value: entry.value,
      gradeStatus: entry.gradeStatus ?? "Saisie",
      author,
    });
    if (result.error) return { ok: false, error: result.error };
    grades = result.grades;
  }

  return {
    ok: true,
    evaluation,
    grades,
    notes: gradesToLegacyNotes(grades),
  };
}

module.exports = {
  resolveTeacherRecordForUser,
  validateGradeValue,
  teacherCanAccessEvaluation,
  createEvaluation,
  publishEvaluation,
  validateEvaluationGrades,
  upsertStudentGrade,
  gradesToLegacyNotes,
  filterGradesForParentOrStudent,
  buildGradeEntrySession,
  formatStudentName,
};
