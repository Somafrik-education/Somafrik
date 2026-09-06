/**
 * LOT 2 — Notes & évaluations V2.
 * PostgreSQL/API = autorité. Identifiants canoniques, jamais catalog.ts / subject string.
 */

export const EVALUATION_STATUS_UI = [
  "Brouillon",
  "Ouverte",
  "Validée",
  "Publiée",
  "Annulée",
] as const;

export type EvaluationStatusUi = (typeof EVALUATION_STATUS_UI)[number];

const EVAL_STATUS_FROM_UI: Record<string, string> = {
  brouillon: "draft",
  ouverte: "open",
  "saisie terminee": "open",
  "saisie terminée": "open",
  validee: "locked",
  validée: "locked",
  publiee: "published",
  publiée: "published",
  annulee: "archived",
  annulée: "archived",
  draft: "draft",
  open: "open",
  locked: "locked",
  published: "published",
  archived: "archived",
};

const EVAL_STATUS_TO_UI: Record<string, EvaluationStatusUi> = {
  draft: "Brouillon",
  open: "Ouverte",
  locked: "Validée",
  published: "Publiée",
  archived: "Annulée",
};

const GRADE_STATUS_FROM_UI: Record<string, string> = {
  saisie: "graded",
  validee: "graded",
  validée: "graded",
  corrigee: "graded",
  corrigée: "graded",
  absente: "absent",
  justifiee: "excused",
  justifiée: "excused",
  "non justifiee": "not_submitted",
  "non justifiée": "not_submitted",
  "en attente": "not_submitted",
  dispensee: "exempt",
  dispensée: "exempt",
  graded: "graded",
  absent: "absent",
  excused: "excused",
  not_submitted: "not_submitted",
  exempt: "exempt",
};

const GRADE_STATUS_TO_UI: Record<string, string> = {
  graded: "Saisie",
  absent: "Absente",
  excused: "Justifiée",
  not_submitted: "Non justifiée",
  exempt: "Dispensée",
};

const EXCLUDED_FROM_AVERAGE = new Set(["absent", "excused", "not_submitted", "exempt"]);

const CLIENT_SCOPE_KEYS = [
  "schoolId",
  "schoolCode",
  "teacherId",
  "teacher_code",
  "teacherCode",
  "createdBy",
  "triggeredBy",
] as const;

export type CanonicalEvaluation = {
  evaluationId: string;
  id: string;
  publicId?: string;
  pgId?: string;
  classId: string;
  classCode?: string;
  className?: string;
  subjectId?: string;
  schoolCourseId?: string;
  courseId?: string;
  courseName?: string;
  subject?: string;
  academicYearId?: string;
  academicYear?: string;
  periodId?: string;
  termId?: string;
  periodName?: string;
  period?: string;
  evaluationTypeId?: string;
  evaluationType?: string;
  evaluationTypeCode?: string;
  teacherId?: string;
  teacherName?: string;
  title: string;
  date: string;
  scale: number;
  maxScore: number;
  coefficient: number;
  status: EvaluationStatusUi;
  canonicalStatus: string;
  active: boolean;
};

export type CanonicalGrade = {
  id: string;
  evaluationId: string;
  studentId: string;
  value?: number;
  score?: number;
  scale: number;
  coefficient: number;
  evaluationCoefficient: number;
  gradeStatus: string;
  status: string;
  subject?: string;
  period?: string;
  date?: string;
  evaluationTitle?: string;
  evaluationType?: string;
  comment?: string;
};

export type CanonicalPeriod = {
  id?: string;
  name: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  status?: string;
};

export type CanonicalRosterStudent = {
  id: string;
  publicId?: string;
  matricule?: string;
  name: string;
  classId?: string | null;
  classCode?: string;
  className?: string;
  archived?: boolean;
  status?: string;
};

export type CreateEvaluationInput = {
  classId: string;
  subjectCode?: string;
  subjectId?: string;
  subject: string;
  period: string;
  termId?: string;
  evaluationTypeId: string;
  date: string;
  scale: number;
  title?: string;
  coefficient?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown): string {
  return asText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function toEvaluationStatus(value: unknown, fallback = "draft"): string {
  const mapped = EVAL_STATUS_FROM_UI[normalizeKey(value)];
  return mapped || fallback;
}

export function fromEvaluationStatus(value: unknown): EvaluationStatusUi {
  const status = toEvaluationStatus(value, "draft");
  return EVAL_STATUS_TO_UI[status] ?? "Brouillon";
}

export function isValidatedEvaluationStatus(value: unknown): boolean {
  return toEvaluationStatus(value, "") === "locked";
}

export function isPublishedEvaluationStatus(value: unknown): boolean {
  return toEvaluationStatus(value, "") === "published";
}

export function isDraftOrOpenEvaluationStatus(value: unknown): boolean {
  const status = toEvaluationStatus(value, "");
  return status === "draft" || status === "open";
}

export function toGradeStatus(value: unknown, hasScore = false): string {
  const mapped = GRADE_STATUS_FROM_UI[normalizeKey(value)];
  if (mapped) return mapped;
  return hasScore ? "graded" : "not_submitted";
}

export function fromGradeStatus(value: unknown): string {
  return GRADE_STATUS_TO_UI[toGradeStatus(value, true)] ?? "Saisie";
}

export function stripEvaluationClientScope(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  for (const key of CLIENT_SCOPE_KEYS) {
    delete next[key];
  }
  return next;
}

export const EVALUATIONS_V2_MISSING_TEACHER =
  "Aucun enseignant n'est affecté à cette évaluation. Vérifiez l'affectation du cours.";

/**
 * Acteur JWT ≠ enseignant pédagogique.
 * Session enseignant : aucun teacherId client (le backend utilise principal.sub).
 * Admin/préfet : teacherId = evaluation.teacherId, obligatoire.
 */
export function gradeSaveActorScope(
  teacherSession: boolean,
  evaluation: { teacherId?: string } | null | undefined,
): { teacherId?: string } {
  if (teacherSession) return {};
  const pedagogical = asText(evaluation?.teacherId);
  if (!pedagogical) {
    throw new Error(EVALUATIONS_V2_MISSING_TEACHER);
  }
  return { teacherId: pedagogical };
}

export function buildCreateEvaluationPayload(input: CreateEvaluationInput): Record<string, unknown> {
  if (!asText(input.classId)) {
    throw new Error("classId canonique obligatoire.");
  }
  if (!asText(input.evaluationTypeId)) {
    throw new Error("evaluationTypeId obligatoire.");
  }
  if (!asText(input.period) && !asText(input.termId)) {
    throw new Error("Période canonique obligatoire.");
  }
  if (!asText(input.subject) && !asText(input.subjectCode) && !asText(input.subjectId)) {
    throw new Error("Cours canonique obligatoire.");
  }
  const scale = Number(input.scale);
  if (!(scale > 0)) {
    throw new Error("Le barème doit être strictement positif.");
  }

  return stripEvaluationClientScope({
    classId: asText(input.classId),
    subjectId: asText(input.subjectId) || undefined,
    subjectCode: asText(input.subjectCode) || undefined,
    subject: asText(input.subject) || undefined,
    period: asText(input.period) || undefined,
    termId: asText(input.termId) || undefined,
    evaluationTypeId: asText(input.evaluationTypeId),
    date: asText(input.date),
    scale,
    title: asText(input.title) || undefined,
    coefficient: Number(input.coefficient ?? 1) || 1,
  });
}

export function buildValidateEvaluationPatch(): Record<string, unknown> {
  return { status: "Validée" };
}

export function teacherCreatePayloadContainsForbiddenFields(payload: Record<string, unknown>): boolean {
  if (asText(payload.teacherId) || asText(payload.teacher_code) || asText(payload.teacherCode)) {
    return true;
  }
  const status = toEvaluationStatus(payload.status, "");
  return status === "locked" || status === "published";
}

export function normalizeEvaluation(raw: unknown): CanonicalEvaluation {
  const row = asRecord(raw);
  const evaluationId = asText(row.id ?? row.publicId ?? row.pgId ?? row.dbId ?? row.evaluationId);
  const scale = Number(row.scale ?? row.maxScore ?? row.max_score ?? 20) || 20;
  const status = fromEvaluationStatus(row.status);
  return {
    evaluationId,
    id: evaluationId,
    publicId: asText(row.publicId) || undefined,
    pgId: asText(row.pgId ?? row.dbId) || undefined,
    classId: asText(row.classId ?? row.class_id),
    classCode: asText(row.classCode ?? row.class_code) || undefined,
    className: asText(row.className) || undefined,
    subjectId: asText(row.subjectId ?? row.subject_id) || undefined,
    schoolCourseId: asText(row.schoolCourseId ?? row.school_course_id) || undefined,
    courseId: asText(row.courseId ?? row.subjectId) || undefined,
    courseName: asText(row.course ?? row.courseName ?? row.subject) || undefined,
    subject: asText(row.subject) || undefined,
    academicYearId: asText(row.academicYearId ?? row.academic_year_id) || undefined,
    academicYear: asText(row.academicYear) || undefined,
    periodId: asText(row.termId ?? row.periodId ?? row.term_id) || undefined,
    termId: asText(row.termId ?? row.term_id) || undefined,
    periodName: asText(row.period ?? row.periodName) || undefined,
    period: asText(row.period) || undefined,
    evaluationTypeId: asText(row.evaluationTypeId ?? row.evaluation_type_id) || undefined,
    evaluationType: asText(row.evaluationType) || undefined,
    evaluationTypeCode: asText(row.evaluationTypeCode) || undefined,
    teacherId: asText(row.teacherId) || undefined,
    teacherName: asText(row.teacherName) || undefined,
    title: asText(row.title) || asText(row.evaluationType) || "Évaluation",
    date: asText(row.date),
    scale,
    maxScore: scale,
    coefficient: Number(row.coefficient ?? 1) || 1,
    status,
    canonicalStatus: toEvaluationStatus(row.status, "draft"),
    active: row.active !== false,
  };
}

export function normalizeGrade(raw: unknown): CanonicalGrade {
  const row = asRecord(raw);
  const scoreRaw = row.value ?? row.score;
  const hasScore = scoreRaw != null && scoreRaw !== "";
  const score = hasScore ? Number(scoreRaw) : undefined;
  const gradeStatus = toGradeStatus(row.gradeStatus ?? row.status, Number.isFinite(score));
  return {
    id: asText(row.id),
    evaluationId: asText(row.evaluationId ?? row.evaluation_id),
    studentId: asText(row.studentId ?? row.student_id),
    value: Number.isFinite(score) ? score : undefined,
    score: Number.isFinite(score) ? score : undefined,
    scale: Number(row.scale ?? row.maxScore ?? 20) || 20,
    coefficient: Number(row.coefficient ?? 1) || 1,
    evaluationCoefficient: Number(row.evaluationCoefficient ?? row.coefficient ?? 1) || 1,
    gradeStatus,
    status: fromGradeStatus(gradeStatus),
    subject: asText(row.subject) || undefined,
    period: asText(row.period) || undefined,
    date: asText(row.date) || undefined,
    evaluationTitle: asText(row.evaluationTitle) || undefined,
    evaluationType: asText(row.evaluationType) || undefined,
    comment: asText(row.comment) || undefined,
  };
}

export function normalizePeriod(raw: unknown): CanonicalPeriod {
  const row = asRecord(raw);
  return {
    id: asText(row.id ?? row.termId ?? row.periodId) || undefined,
    name: asText(row.name),
    type: asText(row.type) || undefined,
    startDate: asText(row.startDate) || undefined,
    endDate: asText(row.endDate) || undefined,
    active: row.active === true,
    status: asText(row.status) || undefined,
  };
}

export function canonicalPeriodsFromConfig(periods: unknown[]): CanonicalPeriod[] {
  return (Array.isArray(periods) ? periods : [])
    .map(normalizePeriod)
    .filter((period) => Boolean(period.name || period.id));
}

export function isPeriodClosed(period: CanonicalPeriod): boolean {
  const status = normalizeKey(period.status);
  if (status === "closed" || status === "ferme" || status === "fermée" || status === "archived") {
    return true;
  }
  return period.active === false && Boolean(period.status);
}

export function selectablePeriods(periods: CanonicalPeriod[]): CanonicalPeriod[] {
  const open = periods.filter((period) => !isPeriodClosed(period));
  return open.length ? open : periods;
}

export function studentApiId(student: CanonicalRosterStudent): string {
  return asText(student.matricule ?? student.publicId ?? student.id);
}

export function rosterStudentsForEvaluation(
  students: CanonicalRosterStudent[],
  evaluation: Pick<CanonicalEvaluation, "classId" | "classCode">,
): CanonicalRosterStudent[] {
  const classId = asText(evaluation.classId);
  const classCode = asText(evaluation.classCode);
  return students.filter((student) => {
    if (student.archived || normalizeKey(student.status) === "archived") return false;
    const studentClassId = asText(student.classId);
    const studentClassCode = asText(student.classCode);
    if (classId && studentClassId && studentClassId === classId) return true;
    if (classCode && studentClassCode && studentClassCode === classCode) return true;
    if (classId && studentClassCode && studentClassCode === classId) return true;
    return false;
  });
}

export function validateGradeValue(raw: string, scale: number): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) {
    return { ok: false, message: "Note manquante." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, message: "La note doit être numérique." };
  }
  if (value < 0 || value > scale) {
    return { ok: false, message: `La note doit être entre 0 et ${scale}.` };
  }
  return { ok: true, value };
}

export function buildSaveNotePayload(options: {
  evaluationId: string;
  studentId: string;
  scale: number;
  value?: number | null;
  gradeStatus?: string;
  className?: string;
  subject?: string;
  period?: string;
  teacherId?: string;
}): Record<string, unknown> {
  const evaluationId = asText(options.evaluationId);
  const studentId = asText(options.studentId);
  if (!evaluationId) {
    throw new Error("evaluationId obligatoire pour la saisie des notes.");
  }
  if (!studentId) {
    throw new Error("Élève obligatoire pour une note.");
  }
  const gradeStatus = toGradeStatus(options.gradeStatus, options.value != null);
  const payload: Record<string, unknown> = {
    evaluationId,
    studentId,
    scale: Number(options.scale),
    gradeStatus,
    status: gradeStatus,
  };
  if (gradeStatus === "graded") {
    payload.value = options.value;
    payload.score = options.value;
  } else {
    payload.value = null;
    payload.score = null;
  }
  if (options.className) payload.className = options.className;
  if (options.subject) payload.subject = options.subject;
  if (options.period) payload.period = options.period;
  const stripped = stripEvaluationClientScope(payload);
  const pedagogical = asText(options.teacherId);
  if (pedagogical) stripped.teacherId = pedagogical;
  return stripped;
}

export function gradesForEvaluation(grades: CanonicalGrade[], evaluationId: string): CanonicalGrade[] {
  const key = asText(evaluationId);
  return grades.filter((grade) => asText(grade.evaluationId) === key);
}

export function notesForStudent(
  grades: CanonicalGrade[],
  studentId: string | readonly string[],
): CanonicalGrade[] {
  const keys = new Set(
    (Array.isArray(studentId) ? studentId : [studentId]).map((value) => asText(value)).filter(Boolean),
  );
  if (!keys.size) return [];
  return grades.filter((grade) => keys.has(asText(grade.studentId)));
}

function gradeCountsInAverage(note: CanonicalGrade): boolean {
  const status = toGradeStatus(note.gradeStatus ?? note.status, note.value != null || note.score != null);
  if (EXCLUDED_FROM_AVERAGE.has(status)) return false;
  if (status !== "graded") return false;
  const score = note.value ?? note.score;
  return score != null && Number.isFinite(Number(score));
}

/**
 * Moyenne pondérée normalisée (8/10 et 12/20 ne sont jamais moyennés naïvement).
 * Aucune note éligible → indisponible (pas 0).
 */
export function canonicalWeightedAverage(
  notes: CanonicalGrade[],
  { displayScale = 20 }: { displayScale?: number } = {},
): { available: boolean; average: number | null; totalCoefficients: number; displayScale: number } {
  let weighted = 0;
  let coefficients = 0;

  for (const note of notes) {
    if (!gradeCountsInAverage(note)) continue;
    const maxScore = Number(note.scale || displayScale);
    const score = Number(note.value ?? note.score);
    const coefficient = Number(note.evaluationCoefficient ?? note.coefficient ?? 1);
    if (!(coefficient > 0) || !(maxScore > 0) || !Number.isFinite(score)) continue;
    weighted += (score / maxScore) * coefficient;
    coefficients += coefficient;
  }

  if (!coefficients) {
    return { available: false, average: null, totalCoefficients: 0, displayScale };
  }

  return {
    available: true,
    average: (weighted / coefficients) * displayScale,
    totalCoefficients: coefficients,
    displayScale,
  };
}

export function evaluationAllowsGradeEntry(evaluation: CanonicalEvaluation): boolean {
  if (evaluation.active === false) return false;
  const status = toEvaluationStatus(evaluation.status ?? evaluation.canonicalStatus, "");
  return status === "draft" || status === "open" || status === "locked";
}

export const EVALUATIONS_V2_COPY = {
  emptyEvaluations: "Aucune évaluation.",
  errorEvaluations: "Impossible de charger les évaluations.",
  offlineEvaluations: "Réseau indisponible. Les évaluations n'ont pas pu être chargées.",
  emptyGrades: "Aucune note pour cette évaluation.",
  errorGrades: "Impossible de charger les notes.",
  offlineGrades: "Réseau indisponible. Les notes n'ont pas pu être chargées.",
  emptyRoster: "Aucun élève inscrit dans cette classe.",
  errorRoster: "Impossible de charger le roster de la classe.",
  offlineRoster: "Réseau indisponible. Le roster n'a pas pu être chargé.",
  emptyNotes: "Aucune note disponible",
  errorNotes: "Impossible de charger les notes.",
  offlineNotes: "Réseau indisponible. Les notes n'ont pas pu être chargées.",
  averageUnavailable: "Moyenne indisponible",
  notValidated: "Évaluation publiée ou annulée : saisie des notes refusée.",
  missingEvaluationTeacher:
    "Aucun enseignant n'est affecté à cette évaluation. Vérifiez l'affectation du cours.",
  teacherCannotValidate: "Validation réservée au préfet ou à l'administration.",
  saving: "Enregistrement…",
  saveGrades: "Enregistrer les notes",
  retry: "Réessayer",
  validate: "Valider l'évaluation",
  create: "Créer l'évaluation",
  enterGrades: "Saisir les notes",
} as const;

export const EVALUATIONS_V2_TEST_IDS = {
  list: "evaluations-v2-list",
  empty: "evaluations-v2-empty",
  error: "evaluations-v2-error",
  createForm: "evaluations-v2-create",
  validateButton: "evaluations-v2-validate",
  gradesForm: "evaluations-v2-grades",
  saveButton: "evaluations-v2-save",
  saveError: "evaluations-v2-save-error",
  notesList: "evaluations-v2-notes-list",
  notesEmpty: "evaluations-v2-notes-empty",
  notesError: "evaluations-v2-notes-error",
  average: "evaluations-v2-average",
} as const;
