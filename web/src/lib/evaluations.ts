import type {
  BackOfficeState,
  Evaluation,
  EvaluationStatus,
  EvaluationType,
  GradeAuditEntry,
  GradeStatus,
  SessionUser,
  StudentGrade,
} from "../types";
import { resolveActivePeriodName } from "./academicPeriods";
import { appendAuditLog, auditActor, makeAuditEntry } from "./audit";
import { todayPeriodDate } from "./dates";
import {
  resolveTeacherRecordForUser,
  scopedCourses,
  scopedStudents,
  teacherScopedClassNames,
} from "./establishment";
import { formatStudentName, GradeBookService } from "./gradeBook";
import { normalize } from "./format";
import { isSuperAdminRole } from "./orgHierarchy";
import { classNamesMatch } from "./classRules";

export { courseOptionsForClass, subjectOptionsForClass } from "./evaluationCourseOptions";

export const MISSING_EVALUATION_TEACHER =
  "Aucun enseignant n'est affecté à cette évaluation. Vérifiez l'affectation du cours.";

export function pedagogicalTeacherId(evaluation: { teacherId?: string } | null | undefined) {
  return String(evaluation?.teacherId ?? "").trim();
}

/** POST notes Admin/Préfet : teacherId pédagogique, jamais authorId acteur. */
export function pedagogyNoteWritePayload(
  note: unknown,
  evaluations: Array<{ id?: string; teacherId?: string }> = [],
): Record<string, unknown> {
  const payload = { ...(note as Record<string, unknown>) };
  const fromNote = String(payload.teacherId ?? "").trim();
  const evaluationId = String(payload.evaluationId ?? "").trim();
  const fromEval = pedagogicalTeacherId(
    evaluations.find((row) => String(row.id ?? "") === evaluationId),
  );
  const teacherId = fromNote || fromEval;
  if (teacherId) payload.teacherId = teacherId;
  delete payload.authorId;
  return payload;
}

export const EVALUATION_STATUSES: EvaluationStatus[] = [
  "Brouillon",
  "Ouverte",
  "Saisie terminée",
  "Validée",
  "Publiée",
  "Annulée",
];

export const GRADE_STATUSES: GradeStatus[] = [
  "Saisie",
  "Absente",
  "Justifiée",
  "Non justifiée",
  "Dispensée",
  "Validée",
  "Corrigée",
  "En attente",
];

export const ABSENCE_GRADE_STATUSES: GradeStatus[] = [
  "Absente",
  "Justifiée",
  "Non justifiée",
  "Dispensée",
  "En attente",
];

export const SCALE_OPTIONS = [10, 20, 100] as const;

const LOCKED_EVALUATION_STATUSES = new Set<EvaluationStatus>(["Validée", "Publiée", "Annulée"]);

let gradeIdCounter = 0;

function authorDisplayName(user: SessionUser | null): string | undefined {
  if (!user) return undefined;
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.identifier;
}

export function newEvaluationId(): string {
  return `EVAL-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function newGradeId(): string {
  gradeIdCounter += 1;
  return `NOTE-${Date.now()}-${gradeIdCounter}`;
}

export function formatGradeDateTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getSchoolAcademicConfig(state: BackOfficeState, schoolCode: string): Record<string, unknown> {
  const configs = state.academicConfigs ?? {};
  return (configs[schoolCode] as Record<string, unknown>) ?? (configs["*"] as Record<string, unknown>) ?? {};
}

/** Projection lecture GET academic-config uniquement — jamais un catalogue local. */
export function getEvaluationTypes(state: BackOfficeState, schoolCode: string): string[] {
  const config = getSchoolAcademicConfig(state, schoolCode);
  const raw = config.evaluationTypes;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

/** Noms de périodes configurées pour l'établissement (fallback trimestres). */
export function getSchoolPeriodNames(state: BackOfficeState, schoolCode: string): string[] {
  const config = getSchoolAcademicConfig(state, schoolCode);
  const periods = Array.isArray(config.periods) ? config.periods : [];
  const names = periods
    .map((item) => String((item as Record<string, unknown>).name ?? "").trim())
    .filter(Boolean);
  return names.length ? names : ["Trimestre 1", "Trimestre 2", "Trimestre 3"];
}

export function resolveDefaultPeriod(state: BackOfficeState, schoolCode: string): string {
  const config = getSchoolAcademicConfig(state, schoolCode);
  const periods = Array.isArray(config.periods) ? config.periods : [];
  const active = resolveActivePeriodName(
    periods.map((item) => {
      const row = item as Record<string, unknown>;
      return { name: String(row.name ?? ""), startDate: String(row.startDate ?? ""), endDate: String(row.endDate ?? "") };
    }),
  );
  return active ?? "Trimestre 1";
}

/** Période affichée par défaut : privilégie une période qui contient déjà des notes. */
export function resolveGradesPeriod(
  state: BackOfficeState,
  schoolCode: string,
  user: SessionUser | null,
): string {
  const normalizedSchool = normalize(schoolCode);
  const grades = scopedGrades(user, state).filter((grade) => {
    if (!normalizedSchool) return true;
    const gradeSchool = normalize(String(grade.schoolCode ?? ""));
    return !gradeSchool || gradeSchool === normalizedSchool;
  });
  const periodCounts = new Map<string, number>();
  for (const grade of grades) {
    const periodName = String(grade.period ?? "").trim();
    if (!periodName) continue;
    periodCounts.set(periodName, (periodCounts.get(periodName) ?? 0) + 1);
  }
  if (periodCounts.size) {
    return [...periodCounts.entries()].sort((left, right) => right[1] - left[1])[0][0];
  }
  return resolveDefaultPeriod(state, schoolCode);
}

export function scopedEvaluations(user: SessionUser | null, state: BackOfficeState): Evaluation[] {
  const schoolCode = String(user?.schoolCode ?? "").trim();
  let rows = (state.evaluations ?? []).filter((row) => row.active !== false);
  if (schoolCode && schoolCode !== "*") {
    rows = rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
  }
  const teacherClasses = teacherScopedClassNames(user, state);
  if (teacherClasses) {
    rows = rows.filter((row) => teacherClasses.has(normalize(row.className)));
  }
  return rows;
}

export function legacyNotesToGrades(notes: unknown[]): StudentGrade[] {
  return (notes ?? []).map((raw) => {
    const note = raw as Record<string, unknown>;
    const value = note.value;
    const numericValue = value === "" || value == null ? undefined : Number(value);
    return {
      id: String(note.id ?? newGradeId()),
      schoolCode: String(note.schoolCode ?? ""),
      studentId: String(note.studentId ?? ""),
      studentName: String(note.studentName ?? ""),
      evaluationId: String(note.evaluationId ?? note.id ?? ""),
      subject: String(note.subject ?? ""),
      className: String(note.className ?? ""),
      period: String(note.period ?? ""),
      value: Number.isFinite(numericValue) ? numericValue : undefined,
      scale: Number(note.scale ?? 20),
      evaluationCoefficient: Number(note.evaluationCoefficient ?? note.coefficient ?? 1),
      coefficient: Number(note.coefficient ?? 1),
      gradeStatus: (note.gradeStatus as GradeStatus) ?? (note.status as GradeStatus) ?? "Saisie",
      comment: String(note.comment ?? ""),
      authorId: String(note.authorId ?? ""),
      teacherId: String(note.teacherId ?? ""),
      enteredAt: String(note.enteredAt ?? ""),
      validatedBy: String(note.validatedBy ?? ""),
      validatedAt: String(note.validatedAt ?? ""),
      date: String(note.date ?? ""),
      audit: Array.isArray(note.audit) ? (note.audit as GradeAuditEntry[]) : [],
    };
  });
}

export function gradesToLegacyNotes(grades: StudentGrade[]): unknown[] {
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
    status: grade.gradeStatus,
    comment: grade.comment,
    teacherId: grade.teacherId,
    authorId: grade.authorId,
    enteredAt: grade.enteredAt,
    validatedBy: grade.validatedBy,
    validatedAt: grade.validatedAt,
    date: grade.date,
    audit: grade.audit ?? [],
  }));
}

export function allGrades(state: BackOfficeState): StudentGrade[] {
  return legacyNotesToGrades(state.notes ?? []);
}

export function scopedGrades(user: SessionUser | null, state: BackOfficeState): StudentGrade[] {
  const students = scopedStudents(user, state);
  const studentIds = new Set(students.map((row) => String(row.id ?? "")).filter(Boolean));
  const studentIdByName = new Map(
    students.map((row) => [normalize(String(row.name ?? "")), String(row.id ?? "")]),
  );

  const rows = allGrades(state)
    .map((grade) => {
      if (grade.studentId) return grade;
      const resolved = studentIdByName.get(normalize(grade.studentName));
      return resolved ? { ...grade, studentId: resolved } : grade;
    })
    .filter((grade) => grade.studentId && studentIds.has(grade.studentId));

  return filterGradesForParentOrStudent(user?.role, rows, state.evaluations ?? []);
}

function isParentOrStudentRole(role?: string): boolean {
  const key = normalize(String(role ?? ""));
  return key.includes("parent") || key.includes("eleve") || key.includes("etudiant");
}

/** Notes visibles parent / élève : uniquement évaluations publiées. */
export function filterGradesForParentOrStudent(
  role: string | undefined,
  grades: StudentGrade[],
  evaluations: Evaluation[],
): StudentGrade[] {
  if (!isParentOrStudentRole(role)) return grades;
  const publishedEvalIds = new Set(
    evaluations
      .filter((row) => row.active !== false && row.status === "Publiée")
      .map((row) => String(row.id)),
  );
  return grades.filter((grade) => {
    const evaluationId = String(grade.evaluationId ?? "");
    return evaluationId && publishedEvalIds.has(evaluationId);
  });
}

export function gradesForEvaluation(grades: StudentGrade[], evaluationId: string): StudentGrade[] {
  return grades.filter((grade) => grade.evaluationId === evaluationId);
}

export function evaluationHasBulletinUsage(evaluation: Evaluation, state: BackOfficeState): boolean {
  const bulletins = (state.bulletins ?? []) as Record<string, unknown>[];
  return bulletins.some(
    (bulletin) =>
      normalize(String(bulletin.period ?? "")) === normalize(evaluation.period) &&
      normalize(String(bulletin.status ?? "")) === "publié" &&
      normalize(String(bulletin.schoolCode ?? "")) === normalize(evaluation.schoolCode),
  );
}

export function canEditEvaluation(evaluation: Evaluation, state: BackOfficeState): boolean {
  if (!evaluation.active) return false;
  if (evaluation.status === "Annulée") return false;
  if (LOCKED_EVALUATION_STATUSES.has(evaluation.status) && evaluationHasBulletinUsage(evaluation, state)) {
    return false;
  }
  return evaluation.status === "Brouillon" || evaluation.status === "Ouverte" || evaluation.status === "Saisie terminée";
}

export function canDeleteEvaluation(evaluation: Evaluation, grades: StudentGrade[]): boolean {
  if (grades.some((grade) => grade.gradeStatus === "Validée" || grade.gradeStatus === "Corrigée")) {
    return false;
  }
  return evaluation.status !== "Publiée";
}

export function validateGradeValue(value: number, scale: number): string | null {
  if (!Number.isFinite(value)) return "La note doit être un nombre.";
  if (value < 0) return "La note ne peut pas être négative.";
  if (value > scale) return `La note ne peut pas dépasser le barème (${scale}).`;
  return null;
}

export function teacherCanAccessEvaluation(
  user: SessionUser | null,
  evaluation: Evaluation,
  state: BackOfficeState,
): boolean {
  if (!user) return false;
  if (isSuperAdminRole(user.role) && user.schoolCode === "*") return true;
  const role = normalize(user.role);
  if (role.includes("admin") || role.includes("prefet") || role.includes("proviseur") || role.includes("directeur")) {
    return true;
  }
  if (role.includes("enseignant") || role.includes("teacher")) {
    const jwtCover = teacherJwtCoversEvaluation(user, evaluation);
    if (jwtCover === true) return true;
    if (jwtCover === false) return false;
    const teacher = resolveTeacherRecordForUser(user, state);
    if (!teacher) return false;
    const teacherName = `${String(teacher.firstName ?? "")} ${String(teacher.lastName ?? "")}`.trim();
    if (evaluation.teacherId && String(evaluation.teacherId) === String(teacher.id)) return true;
    if (evaluation.teacherName && normalize(evaluation.teacherName) === normalize(teacherName)) return true;
    const assignments = (state.assignments ?? []) as Record<string, unknown>[];
    return assignments.some(
      (assignment) =>
        assignmentMatchesEvaluationClass(assignment, evaluation) &&
        assignmentMatchesEvaluationSubject(assignment, evaluation) &&
        String(assignment.teacherId ?? "") === String(teacher.id),
    );
  }
  return false;
}

function isActiveAssignmentStatus(status: unknown): boolean {
  const normalized = normalize(String(status ?? ""));
  if (!normalized) return false;
  return ["active", "actif", "open", "ouverte"].includes(normalized);
}

function assignmentMatchesEvaluationClass(assignment: Record<string, unknown>, evaluation: Evaluation): boolean {
  const assignmentClassId = String(assignment.classId ?? assignment.class_id ?? "").trim();
  const evaluationClassId = String(evaluation.classId ?? "").trim();
  if (assignmentClassId && evaluationClassId) {
    return assignmentClassId === evaluationClassId;
  }
  return classNamesMatch(assignment.className ?? assignment.class_name, evaluation.className);
}

function assignmentMatchesEvaluationSubject(assignment: Record<string, unknown>, evaluation: Evaluation): boolean {
  const course = normalize(String(assignment.course ?? assignment.subject ?? assignment.name ?? ""));
  if (!course) return false;
  return course === normalize(evaluation.subject) || course === normalize(String(evaluation.course ?? ""));
}

/** JWT affectations actives : classe + cours. `null` = pas d'assignments JWT (repli state). */
function teacherJwtCoversEvaluation(user: SessionUser, evaluation: Evaluation): boolean | null {
  const assignments = Array.isArray(user.assignments) ? user.assignments : [];
  if (!assignments.length) return null;
  return assignments.some((raw) => {
    const assignment = raw as Record<string, unknown>;
    if (!isActiveAssignmentStatus(assignment.status ?? assignment.assignmentStatus)) return false;
    return assignmentMatchesEvaluationClass(assignment, evaluation) && assignmentMatchesEvaluationSubject(assignment, evaluation);
  });
}

export function canEnterGradesForEvaluation(
  user: SessionUser | null,
  evaluation: Evaluation | null | undefined,
  state: BackOfficeState,
): boolean {
  if (!user || !evaluation) return false;
  if (evaluation.active === false) return false;
  if (evaluation.status !== "Validée") return false;
  return teacherCanAccessEvaluation(user, evaluation, state);
}

export function evaluationsEligibleForGradeEntry(
  user: SessionUser | null,
  evaluations: Evaluation[],
  state: BackOfficeState,
): Evaluation[] {
  return evaluations.filter((evaluation) => canEnterGradesForEvaluation(user, evaluation, state));
}

export function buildEvaluationsFromExams(state: BackOfficeState, schoolCode: string): Evaluation[] {
  const existing = state.evaluations ?? [];
  const existingExamIds = new Set(existing.map((row) => row.linkedExamId).filter(Boolean));
  const exams = (state.exams ?? []) as Record<string, unknown>[];
  const created: Evaluation[] = [];

  for (const exam of exams) {
    if (normalize(String(exam.schoolCode ?? schoolCode)) !== normalize(schoolCode)) continue;
    const examId = String(exam.id ?? "");
    if (!examId || existingExamIds.has(examId)) continue;
    created.push({
      id: newEvaluationId(),
      schoolCode,
      className: String(exam.className ?? ""),
      subject: String(exam.subject ?? ""),
      period: String(exam.period ?? resolveDefaultPeriod(state, schoolCode)),
      evaluationType: mapExamType(String(exam.examType ?? "Examen")),
      title: String(exam.name ?? exam.title ?? "Évaluation"),
      date: String(exam.date ?? ""),
      scale: 20,
      coefficient: 1,
      status: mapExamStatus(String(exam.status ?? "Programmé")),
      active: true,
      linkedExamId: examId,
      createdAt: formatGradeDateTime(),
    });
  }

  return created;
}

function mapExamType(value: string): EvaluationType {
  const normalized = normalize(value);
  if (normalized.includes("devoir")) return "Devoir";
  if (normalized.includes("interro")) return "Interrogation";
  if (normalized.includes("compo")) return "Composition";
  if (normalized.includes("rattrap")) return "Rattrapage";
  if (normalized.includes("continu")) return "Contrôle continu";
  return "Examen";
}

function mapExamStatus(value: string): EvaluationStatus {
  const normalized = normalize(value);
  if (normalized.includes("publi")) return "Publiée";
  if (normalized.includes("valid")) return "Validée";
  if (normalized.includes("cours")) return "Ouverte";
  return "Brouillon";
}

export function createEvaluation(
  input: Omit<Evaluation, "id" | "active" | "createdAt" | "status"> & { status?: EvaluationStatus },
  author: SessionUser | null,
): Evaluation {
  const now = formatGradeDateTime();
  return {
    ...input,
    id: newEvaluationId(),
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

export function updateEvaluation(
  evaluation: Evaluation,
  patch: Partial<Evaluation>,
  author: SessionUser | null,
  state: BackOfficeState,
): { evaluation: Evaluation; error?: string } {
  if (!canEditEvaluation(evaluation, state)) {
    return { evaluation, error: "Cette évaluation ne peut plus être modifiée librement." };
  }
  const now = formatGradeDateTime();
  const history: GradeAuditEntry[] = [
    ...(evaluation.history ?? []),
    {
      authorId: author?.id ?? "SYSTEM",
      authorName: authorDisplayName(author),
      action: "evaluation.update",
      oldValue: evaluation.title,
      newValue: patch.title ?? evaluation.title,
      date: now,
    },
  ];
  return {
    evaluation: {
      ...evaluation,
      ...patch,
      updatedAt: now,
      history,
    },
  };
}

export function deactivateEvaluation(
  evaluation: Evaluation,
  author: SessionUser | null,
  reason?: string,
): Evaluation {
  const now = formatGradeDateTime();
  return {
    ...evaluation,
    active: false,
    status: "Annulée",
    updatedAt: now,
    history: [
      ...(evaluation.history ?? []),
      {
        authorId: author?.id ?? "SYSTEM",
        authorName: authorDisplayName(author),
        action: "evaluation.deactivate",
        reason,
        date: now,
      },
    ],
  };
}

export function upsertStudentGrade(
  grades: StudentGrade[],
  evaluation: Evaluation,
  student: Record<string, unknown>,
  input: {
    value?: number;
    gradeStatus: GradeStatus;
    comment?: string;
    author: SessionUser | null;
  },
): { grades: StudentGrade[]; error?: string } {
  if (evaluation.active === false) {
    return { grades, error: "Évaluation inactive : saisie des notes refusée." };
  }
  if (evaluation.status !== "Validée") {
    return { grades, error: "Évaluation non validée : saisie des notes refusée." };
  }
  const teacherId = pedagogicalTeacherId(evaluation);
  if (!teacherId) {
    return { grades, error: MISSING_EVALUATION_TEACHER };
  }
  if (LOCKED_EVALUATION_STATUSES.has(evaluation.status) && input.gradeStatus !== "Corrigée") {
    const existing = grades.find(
      (grade) => grade.evaluationId === evaluation.id && grade.studentId === String(student.id ?? ""),
    );
    if (existing && (existing.gradeStatus === "Validée" || existing.gradeStatus === "Corrigée")) {
      return { grades, error: "Note validée : utilisez la correction autorisée." };
    }
  }

  const studentId = String(student.id ?? "");
  const now = formatGradeDateTime();
  const existingIndex = grades.findIndex(
    (grade) => grade.evaluationId === evaluation.id && grade.studentId === studentId,
  );
  const isAbsence = ABSENCE_GRADE_STATUSES.includes(input.gradeStatus);

  if (!isAbsence && input.value != null) {
    const validationError = validateGradeValue(input.value, evaluation.scale);
    if (validationError) return { grades, error: validationError };
  }

  const base: StudentGrade = {
    id: existingIndex >= 0 ? grades[existingIndex].id : newGradeId(),
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
    gradeStatus: input.gradeStatus,
    comment: input.comment,
    teacherId,
    authorId: input.author?.id,
    authorName: authorDisplayName(input.author),
    enteredAt: now,
    date: evaluation.date ?? todayPeriodDate(),
    audit: existingIndex >= 0 ? [...(grades[existingIndex].audit ?? [])] : [],
  };

  if (existingIndex >= 0) {
    const previous = grades[existingIndex];
    base.audit = [
      ...(previous.audit ?? []),
      {
        authorId: input.author?.id ?? "SYSTEM",
        authorName: authorDisplayName(input.author),
        action: "grade.update",
        oldValue: previous.value,
        newValue: input.value,
        date: now,
      },
    ];
  } else {
    base.audit = [
      {
        authorId: input.author?.id ?? "SYSTEM",
        authorName: authorDisplayName(input.author),
        action: "grade.create",
        newValue: input.value,
        date: now,
      },
    ];
  }

  const next = [...grades];
  if (existingIndex >= 0) next[existingIndex] = base;
  else next.push(base);
  return { grades: next };
}

export function correctValidatedGrade(
  grades: StudentGrade[],
  gradeId: string,
  newValue: number,
  reason: string,
  author: SessionUser | null,
): { grades: StudentGrade[]; error?: string } {
  const index = grades.findIndex((grade) => grade.id === gradeId);
  if (index < 0) return { grades, error: "Note introuvable." };
  if (!reason.trim()) return { grades, error: "Le motif de correction est obligatoire." };

  const current = grades[index];
  const validationError = validateGradeValue(newValue, current.scale);
  if (validationError) return { grades, error: validationError };

  const now = formatGradeDateTime();
  const updated: StudentGrade = {
    ...current,
    value: newValue,
    gradeStatus: "Corrigée",
    audit: [
      ...(current.audit ?? []),
      {
        authorId: author?.id ?? "SYSTEM",
        authorName: authorDisplayName(author),
        action: "grade.correct",
        oldValue: current.value,
        newValue,
        reason,
        date: now,
      },
    ],
  };
  const next = [...grades];
  next[index] = updated;
  return { grades: next };
}

export function validateEvaluationGrades(
  evaluation: Evaluation,
  grades: StudentGrade[],
  author: SessionUser | null,
): { evaluation: Evaluation; grades: StudentGrade[] } {
  const now = formatGradeDateTime();
  const nextGrades = grades.map((grade) => {
    if (grade.evaluationId !== evaluation.id) return grade;
    if (ABSENCE_GRADE_STATUSES.includes(grade.gradeStatus)) return grade;
    if (grade.value == null) return grade;
    return {
      ...grade,
      gradeStatus: "Validée" as GradeStatus,
      validatedBy: author?.id,
      validatedByName: authorDisplayName(author),
      validatedAt: now,
      audit: [
        ...(grade.audit ?? []),
        {
          authorId: author?.id ?? "SYSTEM",
          authorName: authorDisplayName(author),
          action: "grade.validate",
          date: now,
        },
      ],
    };
  });

  const nextEvaluation: Evaluation = {
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

export function publishEvaluation(
  evaluation: Evaluation,
  author: SessionUser | null,
): Evaluation {
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

export function syncBulletinsForClass(
  state: BackOfficeState,
  schoolCode: string,
  className: string,
  period: string,
  students: Record<string, unknown>[],
  grades: StudentGrade[],
): Record<string, unknown>[] {
  const courses = scopedCourses(null, state) as Record<string, unknown>[];
  const classStudents = students.filter(
    (student) => normalize(String(student.className ?? "")) === normalize(className),
  );
  const gradeBook = new GradeBookService(classStudents, grades, courses);
  const bulletins = [...((state.bulletins ?? []) as Record<string, unknown>[])];

  for (const student of classStudents) {
    const studentId = String(student.id ?? "");
    const averages = gradeBook.getStudentAverage(studentId, period);
    const bulletinId = `BUL-${schoolCode}-${studentId}-${period.replace(/\s+/g, "-").toUpperCase()}`;
    const existingIndex = bulletins.findIndex((row) => String(row.id) === bulletinId);
    const payload = {
      id: bulletinId,
      schoolCode,
      studentId,
      studentName: formatStudentName(student),
      className,
      period,
      average: averages.average.toFixed(1),
      rank: averages.rankLabel.replace(" / ", "/"),
      status: "En validation",
      teacherComment: GradeBookService.getAutomaticAppreciation(averages.average),
      principalComment: "",
    };
    if (existingIndex >= 0) {
      bulletins[existingIndex] = { ...bulletins[existingIndex], ...payload };
    } else {
      bulletins.push(payload);
    }
  }

  return bulletins;
}

export function buildGradeBook(state: BackOfficeState, user: SessionUser | null, period?: string) {
  const students = scopedStudents(user, state) as Record<string, unknown>[];
  const grades = scopedGrades(user, state).filter(
    (grade) => !period || normalize(grade.period) === normalize(period),
  );
  const courses = scopedCourses(user, state) as Record<string, unknown>[];
  return new GradeBookService(students, grades, courses);
}

export function appendGradeAuditLog(
  auditLog: unknown[] | undefined,
  action: string,
  user: SessionUser | null,
  details?: Record<string, unknown>,
) {
  return appendAuditLog(
    auditLog,
    makeAuditEntry({
      action,
      entityType: "Notes",
      schoolCode: user?.schoolCode,
      details: details ? JSON.stringify(details) : undefined,
      ...auditActor(user),
    }),
  );
}

export function ensureEvaluationsSynced(state: BackOfficeState, schoolCode: string): Evaluation[] {
  const current = state.evaluations ?? [];
  const imported = buildEvaluationsFromExams(state, schoolCode);
  return [...current, ...imported];
}
