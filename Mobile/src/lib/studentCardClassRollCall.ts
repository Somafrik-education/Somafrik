/**
 * CARTE-PR3-M2 — appel de classe complet (enseignant affecté), logique pure.
 *
 * Contrat Backend (#945) :
 *  - GET /student-cards/roll-call/roster : élèves activement inscrits, statut existant, statut
 *    provisoire (`absent` sans statut) et `matchKey` propre à la session ;
 *  - le scan renvoie une `dedupKey` égale au `matchKey` de l'élève : le rapprochement se fait
 *    uniquement sur cette clé, la réponse du scan ne contient aucune identité ;
 *  - POST /student-cards/roll-call/validate avec `complete: true` (confirmation explicite) :
 *    reçus des élèves scannés + pointage manuel des autres élèves modifiables.
 *
 * Règles locales (le serveur reste seul juge) :
 *  - rien n'est enregistré à l'ouverture ni au scan : le brouillon vit en mémoire ;
 *  - un statut existant `present`, `late` ou `excused` est conservé et non modifiable ;
 *  - un élève sans statut est « Absent » provisoire ; un absent existant peut être corrigé.
 */

export type AttendanceStatus = "present" | "late" | "absent" | "excused";
export type EditableStatus = "present" | "late" | "absent";
export type MarkSource = "existing" | "default" | "manual" | "card";

export type RosterStudent = {
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  existingStatus: AttendanceStatus | null;
  matchKey: string;
};

export type StudentMark = { status: AttendanceStatus; source: MarkSource; receipt?: string };

export type ClassRollCallDraft = {
  scopeKey: string;
  sessionId: string;
  classId: string;
  date: string;
  students: RosterStudent[];
  marks: Record<string, StudentMark>;
};

export type ClassRollCallCounts = { present: number; absent: number; late: number; excused: number; total: number };

export type ClassRollCallFeedback = { kind: "accepted" | "duplicate" | "refused" | "info" | "error"; message: string };

export const CLASS_ROLL_CALL_COPY = {
  start: "Faire l'appel de la classe",
  resume: "Reprendre l'appel de la classe",
  title: "Appel de la classe",
  loading: "Chargement de la liste de la classe…",
  loadFailed: "La liste de la classe n'a pas pu être chargée. Réessayez.",
  empty: "Aucun élève inscrit dans cette classe.",
  draft: "Brouillon : rien n'est enregistré avant la confirmation de l'appel.",
  defaultAbsent: "Les élèves non pointés sont « Absent » jusqu'à la validation.",
  allPresent: "Tous présents",
  allPresentDone: "Tous les élèves modifiables sont marqués présents.",
  scanNfc: "Scanner les cartes NFC",
  scanQr: "Scanner les QR codes",
  stopScan: "Arrêter le scan",
  instructionsNfc: "Présentez les cartes NFC successivement.",
  instructionsQr: "Présentez les QR codes successivement devant la caméra.",
  scanned: (name: string) => `${name} : présent.`,
  duplicate: (name: string) => `${name} : déjà scanné.`,
  locked: (name: string, label: string) => `${name} : statut « ${label} » déjà enregistré, conservé.`,
  notInList: "Carte non rattachée à la liste de cette classe.",
  refusedClass: "Carte d'un élève d'une autre classe.",
  refusedCard: "Carte refusée : inconnue, remplacée, perdue ou révoquée.",
  notSomafrik: "Cette carte n'est pas une carte élève Somafrik.",
  forbidden: "Cette classe n'est pas dans votre périmètre d'appel.",
  offline: "Connexion indisponible : la carte n'a pas été comptée.",
  timeout: "Réseau lent : présentez de nouveau la carte.",
  scanFailed: "La carte n'a pas pu être vérifiée. Présentez-la de nouveau.",
  nfcUnavailable: "NFC indisponible ou désactivé sur cet appareil.",
  lockedHint: "Déjà enregistré",
  review: "Vérifier et valider l'appel",
  confirmTitle: "Confirmer l'appel complet",
  confirmBody: (counts: ClassRollCallCounts) =>
    `${counts.present} présent(s), ${counts.late} retard(s), ${counts.excused} justifié(s) et ${counts.absent} absent(s) sur ${counts.total} élève(s).\n\n` +
    (counts.absent > 0
      ? `${counts.absent} absence(s) seront enregistrées et pourront être notifiées aux familles.`
      : "Aucune absence ne sera enregistrée."),
  confirm: "Confirmer et enregistrer",
  cancel: "Revenir à l'appel",
  validating: "Validation en cours…",
  validated: (counts: ClassRollCallCounts) =>
    `Appel enregistré : ${counts.present} présent(s), ${counts.absent} absent(s), ${counts.late} retard(s), ${counts.excused} justifié(s).`,
  protectedNotice: (count: number) => `${count} statut(s) déjà enregistré(s) conservé(s) sans modification.`,
  rosterChanged: "La liste de la classe a changé depuis l'ouverture de l'appel : elle a été rechargée, vérifiez puis validez à nouveau.",
  alreadyValidated: "Cet appel a déjà été validé.",
  cardsInvalid: (count: number) => `${count} scan(s) retiré(s) : carte devenue invalide. Vérifiez la liste puis validez à nouveau.`,
  expired: "Les scans ont expiré : rescannez les cartes concernées puis validez.",
  concurrent: "Les présences ont été modifiées pendant l'appel : rechargez la liste puis validez à nouveau.",
  roleForbidden: "Votre rôle ne permet pas de faire l'appel de cette classe.",
  validateFailed: "L'appel n'a pas été enregistré. Réessayez.",
  close: "Fermer (garder le brouillon)",
  abandon: "Abandonner l'appel",
  abandonConfirmTitle: "Abandonner l'appel ?",
  abandonConfirmBody: "Le brouillon sera oublié. Aucune présence n'a été enregistrée.",
  abandonConfirm: "Abandonner",
  keep: "Continuer l'appel",
} as const;

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Présent",
  late: "Retard",
  absent: "Absent",
  excused: "Justifié",
};

export const EDITABLE_STATUSES: readonly EditableStatus[] = ["present", "late", "absent"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set<AttendanceStatus>(["present", "late", "absent", "excused"]);
const LOCKED = new Set<AttendanceStatus>(["present", "late", "excused"]);

const text = (value: unknown, max = 120) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Liste blanche de la réponse roster : tout champ inattendu est ignoré, toute ligne invalide écartée. */
export function parseRollCallRoster(raw: unknown): RosterStudent[] | null {
  const value = raw && typeof raw === "object" ? (raw as { students?: unknown }) : null;
  if (!value || !Array.isArray(value.students)) return null;
  const seen = new Set<string>();
  const students: RosterStudent[] = [];
  for (const item of value.students) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!row || typeof row.studentId !== "string" || !UUID.test(row.studentId)) continue;
    const studentId = row.studentId.toLowerCase();
    const matchKey = text(row.matchKey, 64);
    if (seen.has(studentId) || !matchKey) continue;
    seen.add(studentId);
    const existing = typeof row.existingStatus === "string" && STATUSES.has(row.existingStatus as AttendanceStatus)
      ? (row.existingStatus as AttendanceStatus)
      : null;
    students.push({
      studentId,
      studentCode: text(row.studentCode, 64),
      firstName: text(row.firstName),
      lastName: text(row.lastName),
      existingStatus: existing,
      matchKey,
    });
  }
  return students;
}

export function studentDisplayName(student: Pick<RosterStudent, "firstName" | "lastName" | "studentCode">): string {
  const name = `${student.firstName} ${student.lastName}`.trim();
  return name || student.studentCode || "Élève";
}

/** Un statut existant présent / retard / justifié est conservé ; un absent existant reste corrigeable. */
export function isLockedStudent(student: RosterStudent): boolean {
  return student.existingStatus !== null && LOCKED.has(student.existingStatus);
}

export function createClassRollCall(
  context: { scopeKey: string; sessionId: string; classId: string; date: string },
  students: RosterStudent[],
): ClassRollCallDraft {
  const marks: Record<string, StudentMark> = {};
  for (const student of students) {
    marks[student.studentId] = student.existingStatus
      ? { status: student.existingStatus, source: "existing" }
      : { status: "absent", source: "default" };
  }
  return { ...context, students, marks };
}

/**
 * Nouvelle liste (après changement d'effectif) : les choix déjà faits sur les élèves toujours
 * présents dans la liste sont conservés, sauf si un statut a été enregistré entre-temps.
 */
export function mergeReloadedRoster(draft: ClassRollCallDraft, students: RosterStudent[]): ClassRollCallDraft {
  const next = createClassRollCall(draft, students);
  for (const student of students) {
    const previous = draft.marks[student.studentId];
    if (!previous || isLockedStudent(student)) continue;
    // La clé de rapprochement est stable pour la session : un reçu reste valable.
    if (previous.source === "manual" || previous.source === "card") next.marks[student.studentId] = previous;
  }
  return next;
}

export function setStudentStatus(draft: ClassRollCallDraft, studentId: string, status: EditableStatus): ClassRollCallDraft {
  const student = draft.students.find((row) => row.studentId === studentId);
  if (!student || isLockedStudent(student) || !EDITABLE_STATUSES.includes(status)) return draft;
  const current = draft.marks[studentId];
  if (current?.status === status && current.source !== "default") return draft;
  // Une correction manuelle remplace un éventuel scan : le reçu n'est plus envoyé.
  return { ...draft, marks: { ...draft.marks, [studentId]: { status, source: "manual" } } };
}

/** « Tous présents » : seuls les élèves modifiables encore absents (provisoires ou existants) passent présents. */
export function markAllPresent(draft: ClassRollCallDraft): ClassRollCallDraft {
  const marks = { ...draft.marks };
  for (const student of draft.students) {
    if (isLockedStudent(student)) continue;
    const mark = marks[student.studentId];
    if (mark?.source === "card" || mark?.status === "present" || mark?.status === "late") continue;
    marks[student.studentId] = { status: "present", source: "manual" };
  }
  return { ...draft, marks };
}

/** Rapprochement d'un scan accepté par le serveur : uniquement via la clé de session. */
export function applyRollCallScan(
  draft: ClassRollCallDraft,
  scan: { dedupKey: string; receipt: string },
): { draft: ClassRollCallDraft; feedback: ClassRollCallFeedback } {
  const student = draft.students.find((row) => row.matchKey === scan.dedupKey);
  if (!student) return { draft, feedback: { kind: "refused", message: CLASS_ROLL_CALL_COPY.notInList } };
  const name = studentDisplayName(student);
  if (isLockedStudent(student)) {
    return {
      draft,
      feedback: { kind: "info", message: CLASS_ROLL_CALL_COPY.locked(name, STATUS_LABELS[student.existingStatus as AttendanceStatus]) },
    };
  }
  if (draft.marks[student.studentId]?.source === "card") {
    return { draft, feedback: { kind: "duplicate", message: CLASS_ROLL_CALL_COPY.duplicate(name) } };
  }
  return {
    draft: { ...draft, marks: { ...draft.marks, [student.studentId]: { status: "present", source: "card", receipt: scan.receipt } } },
    feedback: { kind: "accepted", message: CLASS_ROLL_CALL_COPY.scanned(name) },
  };
}

export function classRollCallCounts(draft: ClassRollCallDraft | null): ClassRollCallCounts {
  const counts: ClassRollCallCounts = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
  if (!draft) return counts;
  for (const student of draft.students) {
    const status = draft.marks[student.studentId]?.status ?? "absent";
    counts[status] += 1;
    counts.total += 1;
  }
  return counts;
}

export function classRollCallCanSubmit(draft: ClassRollCallDraft | null): boolean {
  return Boolean(draft && draft.students.length > 0);
}

/**
 * Corps de validation de l'appel complet : reçus des élèves scannés, pointage manuel de tous les
 * autres élèves modifiables (absences comprises) ; les statuts existants conservés ne sont pas
 * renvoyés (le serveur les compte comme couverts).
 */
export function classRollCallValidateBody(draft: ClassRollCallDraft) {
  const receipts: string[] = [];
  const receiptStudentIds: string[] = [];
  const manual: { studentId: string; status: EditableStatus }[] = [];
  for (const student of draft.students) {
    if (isLockedStudent(student)) continue;
    const mark = draft.marks[student.studentId] ?? { status: "absent", source: "default" };
    if (mark.source === "card" && mark.receipt) {
      receipts.push(mark.receipt);
      receiptStudentIds.push(student.studentId);
      continue;
    }
    const status = mark.status === "excused" ? "absent" : mark.status;
    manual.push({ studentId: student.studentId, status });
  }
  return {
    body: {
      sessionId: draft.sessionId,
      classId: draft.classId,
      date: draft.date,
      mode: "teacher" as const,
      receipts,
      manual,
      complete: true as const,
    },
    receiptStudentIds,
  };
}

type ApiErrorLike = { status?: number; code?: string; details?: unknown; message?: string };
const asApiError = (error: unknown): ApiErrorLike => (error && typeof error === "object" ? (error as ApiErrorLike) : {});

export function classRollCallScanFailure(error: unknown): { feedback: ClassRollCallFeedback; stop: boolean } {
  const { status, code } = asApiError(error);
  if (code === "ROLL_CALL_CLASS_MISMATCH") return { feedback: { kind: "refused", message: CLASS_ROLL_CALL_COPY.refusedClass }, stop: false };
  if (code === "ROLL_CALL_ROLE_FORBIDDEN") return { feedback: { kind: "error", message: CLASS_ROLL_CALL_COPY.roleForbidden }, stop: true };
  if (code === "ROLL_CALL_CLASS_FORBIDDEN" || status === 401 || status === 403) {
    return { feedback: { kind: "error", message: CLASS_ROLL_CALL_COPY.forbidden }, stop: true };
  }
  if (status === 404 || status === 409 || code === "STUDENT_CARD_NOT_FOUND" || code === "STUDENT_CARD_INVALID_STATE") {
    return { feedback: { kind: "refused", message: CLASS_ROLL_CALL_COPY.refusedCard }, stop: false };
  }
  if (status === 400) return { feedback: { kind: "refused", message: CLASS_ROLL_CALL_COPY.notSomafrik }, stop: false };
  if (code === "NETWORK_UNAVAILABLE" || status === 0) return { feedback: { kind: "error", message: CLASS_ROLL_CALL_COPY.offline }, stop: false };
  if (code === "TIMEOUT") return { feedback: { kind: "error", message: CLASS_ROLL_CALL_COPY.timeout }, stop: false };
  return { feedback: { kind: "error", message: CLASS_ROLL_CALL_COPY.scanFailed }, stop: false };
}

export type ServerCounts = { present: number; absent: number; late: number; excused: number; enrolled: number };

export type ClassRollCallOutcome =
  | { kind: "validated"; message: string; counts: ServerCounts | null; protectedCount: number }
  | { kind: "roster_changed"; message: string }
  | { kind: "cards_invalid"; draft: ClassRollCallDraft; message: string }
  | { kind: "expired"; draft: ClassRollCallDraft; message: string }
  | { kind: "error"; message: string };

function parseServerCounts(raw: unknown): ServerCounts | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!value) return null;
  const n = (key: string) => (Number.isInteger(value[key]) && (value[key] as number) >= 0 ? (value[key] as number) : 0);
  return { present: n("present"), absent: n("absent"), late: n("late"), excused: n("excused"), enrolled: n("enrolled") };
}

/** Scans retirés : les élèves concernés redeviennent « Absent » provisoire (rien n'est perdu en silence). */
function dropReceipts(draft: ClassRollCallDraft, studentIds: readonly string[]): ClassRollCallDraft {
  if (studentIds.length === 0) return draft;
  const marks = { ...draft.marks };
  for (const studentId of studentIds) {
    if (marks[studentId]?.source === "card") marks[studentId] = { status: "absent", source: "default" };
  }
  return { ...draft, marks };
}

export async function validateClassRollCall(
  draft: ClassRollCallDraft,
  deps: {
    validate: (
      body: ReturnType<typeof classRollCallValidateBody>["body"],
      options: { idempotencyKey: string },
    ) => Promise<{ counts?: unknown; protected?: unknown; idempotentReplay?: unknown }>;
  },
): Promise<ClassRollCallOutcome> {
  if (!classRollCallCanSubmit(draft)) return { kind: "error", message: CLASS_ROLL_CALL_COPY.empty };
  const { body, receiptStudentIds } = classRollCallValidateBody(draft);
  try {
    // Identifiant d'opération stable : la session. Un nouvel essai rejoue la même opération.
    const result = await deps.validate(body, { idempotencyKey: draft.sessionId });
    const counts = parseServerCounts(result?.counts);
    const protectedCount = Number.isInteger(result?.protected) ? (result.protected as number) : 0;
    const shown = counts
      ? { ...counts, total: counts.enrolled }
      : classRollCallCounts(draft);
    let message: string = CLASS_ROLL_CALL_COPY.validated(shown);
    if (protectedCount > 0) message += ` ${CLASS_ROLL_CALL_COPY.protectedNotice(protectedCount)}`;
    return { kind: "validated", message, counts, protectedCount };
  } catch (error) {
    const { code, details } = asApiError(error);
    if (code === "ROLL_CALL_ROSTER_CHANGED") return { kind: "roster_changed", message: CLASS_ROLL_CALL_COPY.rosterChanged };
    if (code === "ROLL_CALL_ALREADY_VALIDATED") {
      return { kind: "validated", message: CLASS_ROLL_CALL_COPY.alreadyValidated, counts: null, protectedCount: 0 };
    }
    if (code === "ROLL_CALL_CARD_INVALID") {
      const indexes = (details as { invalidReceiptIndexes?: unknown })?.invalidReceiptIndexes;
      const dropped = Array.isArray(indexes)
        ? indexes.filter((value): value is number => Number.isInteger(value)).map((index) => receiptStudentIds[index]).filter(Boolean)
        : [];
      return { kind: "cards_invalid", draft: dropReceipts(draft, dropped), message: CLASS_ROLL_CALL_COPY.cardsInvalid(dropped.length) };
    }
    if (code === "ROLL_CALL_RECEIPT_EXPIRED" || code === "ROLL_CALL_RECEIPT_INVALID" || code === "ROLL_CALL_CONTEXT_MISMATCH") {
      return { kind: "expired", draft: dropReceipts(draft, receiptStudentIds), message: CLASS_ROLL_CALL_COPY.expired };
    }
    if (code === "ROLL_CALL_CONCURRENT_UPDATE") return { kind: "roster_changed", message: CLASS_ROLL_CALL_COPY.concurrent };
    if (code === "ROLL_CALL_ROLE_FORBIDDEN" || code === "ROLL_CALL_CLASS_FORBIDDEN") {
      return { kind: "error", message: CLASS_ROLL_CALL_COPY.roleForbidden };
    }
    const failure = classRollCallScanFailure(error).feedback.message;
    return { kind: "error", message: failure === CLASS_ROLL_CALL_COPY.offline ? CLASS_ROLL_CALL_COPY.offline : CLASS_ROLL_CALL_COPY.validateFailed };
  }
}
