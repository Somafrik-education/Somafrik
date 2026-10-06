/**
 * CARTE-PR7 — politique scanner QR Mobile.
 * Le capability reste en mémoire volatile. Aucun stockage, aucun log du token.
 */

export const CANONICAL_CAMERA_PERMISSION =
  "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.";

export const MAX_QR_CAPABILITY_LENGTH = 256;

export const STUDENT_CARD_SCAN_COPY = {
  button: "Scanner une carte QR",
  title: "Scanner une carte élève",
  subtitle: "Présentez le QR de la carte devant l’appareil photo.",
  permissionRationale: "L’appareil photo sert uniquement à lire le QR de la carte élève.",
  permissionDenied: "Caméra non autorisée. Le scanner QR est indisponible.",
  permissionBlocked:
    "Caméra non autorisée. Le scanner QR est indisponible. Vous pouvez l’activer dans les réglages.",
  openSettings: "Ouvrir les réglages",
  requestPermission: "Autoriser l’appareil photo",
  close: "Fermer",
  offline: "Le scan QR nécessite une connexion Internet.",
  rearm: "Scanner une autre carte",
  scanning: "Lecture du QR…",
  resolving: "Identification en cours…",
  classMismatch: "Cette carte n’appartient pas à la classe actuellement sélectionnée.",
  invalidCard: "Cette carte n’est plus valide.",
  identified: "Élève identifié",
  attendanceRecorded: "Présence enregistrée",
  financeUnavailable: "Situation financière indisponible",
  financeNotice: "Le contrôle financier est informatif. Il ne bloque pas la prise de présence.",
  cameraUnavailable: "Scanner QR indisponible.",
} as const;

const SCAN_ERROR_MESSAGES: Record<string, string> = {
  STUDENT_CARD_DISABLED: "La carte élève est désactivée pour cet établissement.",
  DISABLED: "La carte élève est désactivée pour cet établissement.",
  STUDENT_CARD_ATTENDANCE_DISABLED: "Le pointage par carte est désactivé.",
  STUDENT_CARD_FINANCE_CHECK_DISABLED: "Le contrôle financier par carte est désactivé.",
  STUDENT_CARD_TOKEN_INVALID: "QR illisible ou carte non reconnue.",
  TOKEN_INVALID: "QR illisible ou carte non reconnue.",
  STUDENT_CARD_NOT_FOUND: "Carte introuvable.",
  NOT_FOUND: "Carte introuvable.",
  STUDENT_CARD_INVALID_STATE: STUDENT_CARD_SCAN_COPY.invalidCard,
  INVALID_STATE: STUDENT_CARD_SCAN_COPY.invalidCard,
  STUDENT_CARD_TENANT_DENIED: "Cette carte n’appartient pas à cet établissement.",
  STUDENT_CARD_ENROLLMENT_UNRESOLVED: "L’élève n’est pas rattaché à une classe active.",
  ENROLLMENT_UNRESOLVED: "L’élève n’est pas rattaché à une classe active.",
  ATTENDANCE_TEACHER_UNRESOLVED: "Choisissez l’enseignant auteur de l’appel avant de pointer.",
  STUDENT_CARD_SCAN_INTENTS_CONFLICT: "Présence et finance ne peuvent pas être demandées ensemble.",
  PERMISSION_DENIED: "Action non autorisée.",
  PLATFORM_PERSONAL_DATA_DENIED: "Accès refusé.",
  IDEMPOTENCY_KEY_REUSED: "Cette opération a déjà été traitée. Réarmez le scanner.",
  NETWORK_UNAVAILABLE: STUDENT_CARD_SCAN_COPY.offline,
  TIMEOUT: "Le serveur n’a pas répondu. Réessayez.",
};

export type StudentCardScanSettings = {
  studentCardEnabled?: boolean;
  studentCardQrEnabled?: boolean;
  studentCardAttendanceEnabled?: boolean;
  studentCardFinanceCheckEnabled?: boolean;
};

export function isStudentCardQrScanEnabled(
  settings: StudentCardScanSettings | null | undefined,
): boolean {
  return settings?.studentCardEnabled === true && settings?.studentCardQrEnabled === true;
}

export function isStudentCardAttendanceScanEnabled(
  settings: StudentCardScanSettings | null | undefined,
): boolean {
  return isStudentCardQrScanEnabled(settings) && settings?.studentCardAttendanceEnabled === true;
}

export function isStudentCardScanAttendanceEnabled(
  settings: StudentCardScanSettings | null | undefined,
): boolean {
  return isStudentCardAttendanceScanEnabled(settings);
}

export function isStudentCardScanFinanceEnabled(
  settings: StudentCardScanSettings | null | undefined,
): boolean {
  return isStudentCardQrScanEnabled(settings) && settings?.studentCardFinanceCheckEnabled === true;
}

export function studentCardScanErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "").trim();
  }
  return "";
}

export function studentCardScanErrorMessage(error: unknown): string {
  const code = studentCardScanErrorCode(error);
  if (code && SCAN_ERROR_MESSAGES[code]) return SCAN_ERROR_MESSAGES[code];
  if (code === "ECONNABORTED" || /timeout/i.test(code)) return SCAN_ERROR_MESSAGES.TIMEOUT;
  if (error instanceof Error) {
    if (/network|internet|offline|failed to fetch/i.test(error.message)) {
      return SCAN_ERROR_MESSAGES.NETWORK_UNAVAILABLE;
    }
    if (/timeout/i.test(error.message)) return SCAN_ERROR_MESSAGES.TIMEOUT;
  }
  return "Le scan n’a pas abouti.";
}

export function extractQrCapability(data: unknown): string {
  const value = String(data ?? "").trim();
  if (!value || value.length > MAX_QR_CAPABILITY_LENGTH) return "";
  return value;
}

export function isQrBarcodeType(type: unknown): boolean {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "qr" || normalized.endsWith(".qr") || normalized.includes("qrcode");
}

export type VolatileCardToken = { current: string | null };

export function holdCardToken(holder: VolatileCardToken, token: string): boolean {
  const next = extractQrCapability(token);
  if (!next || holder.current) return false;
  holder.current = next;
  return true;
}

export function releaseCardToken(holder: VolatileCardToken): void {
  holder.current = null;
}

export function isoAttendanceDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type StudentCardClassRef = {
  id?: string;
  classId?: string;
  classCode?: string;
  className?: string;
};

export type SelectedAttendanceClassRef = {
  classId?: string;
  classCode?: string;
  className?: string;
};

export function hasValidSelectedClass(
  selected: SelectedAttendanceClassRef | null | undefined,
): boolean {
  if (!selected) return false;
  return Boolean(String(selected.classId ?? "").trim() || String(selected.classCode ?? "").trim());
}

export function scanScopeKey(input: {
  resourceScopeKey?: string;
  schoolCode?: string;
  classId?: string;
  classCode?: string;
}): string {
  return [
    String(input.resourceScopeKey ?? "").trim(),
    String(input.schoolCode ?? "").trim(),
    String(input.classId ?? "").trim(),
    String(input.classCode ?? "").trim(),
  ].join("|");
}

export function cardBelongsToSelectedClass(
  cardClass: StudentCardClassRef | null | undefined,
  selected: SelectedAttendanceClassRef | null | undefined,
): boolean {
  if (!cardClass || !hasValidSelectedClass(selected)) return false;
  const cardId = String(cardClass.id ?? cardClass.classId ?? "").trim();
  const selectedId = String(selected?.classId ?? "").trim();
  if (cardId && selectedId) return cardId === selectedId;
  const cardCode = String(cardClass.classCode ?? "").trim();
  const selectedCode = String(selected?.classCode ?? "").trim();
  if (cardCode && selectedCode) return cardCode === selectedCode;
  return false;
}

export function isInvalidCardStatus(status: unknown): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  return value === "lost" || value === "revoked" || value === "replaced";
}

export type AttendanceAuthorReady =
  | { status: "teacher_session" }
  | { status: "auto"; teacherId: string }
  | { status: "selected"; teacherId: string }
  | { status: "need_selection" }
  | { status: "blocked"; message?: string }
  | { status: string; teacherId?: string; message?: string };

export function isAttendanceAuthorReady(
  decision: AttendanceAuthorReady | null | undefined,
): { ok: true; teacherId?: string } | { ok: false } {
  if (!decision) return { ok: false };
  if (decision.status === "teacher_session") return { ok: true };
  if (decision.status === "auto" || decision.status === "selected") {
    const teacherId = String(decision.teacherId ?? "").trim();
    return teacherId ? { ok: true, teacherId } : { ok: false };
  }
  return { ok: false };
}

export type ScanScopeSnapshot = {
  generation: number;
  resourceScopeKey: string;
  schoolCode: string;
  classId: string;
  classCode: string;
};

export function isStaleScanScope(
  started: ScanScopeSnapshot,
  current: ScanScopeSnapshot | null | undefined,
): boolean {
  if (!current) return true;
  return (
    started.generation !== current.generation ||
    started.resourceScopeKey !== current.resourceScopeKey ||
    started.schoolCode !== current.schoolCode ||
    started.classId !== current.classId ||
    started.classCode !== current.classCode
  );
}

export function assertIdempotencyKeySafe(key: string, cardToken: string): void {
  const token = String(cardToken ?? "");
  if (token && key.includes(token)) {
    throw new Error("Idempotency-Key ne doit pas contenir le capability.");
  }
}

export type StudentCardScanStudentView = {
  id?: string;
  studentCode?: string;
  firstName?: string;
  lastName?: string;
};

export type StudentCardScanResolved = {
  card?: { status?: string };
  student?: StudentCardScanStudentView;
  class?: StudentCardClassRef;
  attendance?: { status?: string; date?: string };
  finance?: { code?: string; label?: string };
};

export type StudentCardScanView = {
  studentId: string;
  studentName: string;
  studentCode: string;
  className: string;
  attendanceRecorded: boolean;
  financeLabel: string;
  financeUnavailable: boolean;
};

export type StudentCardScanOutcome =
  | { kind: "stale" }
  | { kind: "offline" }
  | { kind: "teacher_unresolved" }
  | { kind: "class_mismatch"; view: StudentCardScanView }
  | { kind: "invalid_card" }
  | { kind: "success"; view: StudentCardScanView }
  | { kind: "error"; message: string };

export function displayStudentName(student: StudentCardScanStudentView | null | undefined): string {
  const first = String(student?.firstName ?? "").trim();
  const last = String(student?.lastName ?? "").trim();
  return `${first} ${last}`.trim() || STUDENT_CARD_SCAN_COPY.identified;
}

export function financeBadgeLabel(finance: { code?: string; label?: string } | null | undefined): string {
  const label = String(finance?.label ?? "").trim();
  if (label) return label;
  const code = String(finance?.code ?? "").trim().toUpperCase();
  if (code === "UP_TO_DATE") return "À jour";
  if (code === "OVERDUE") return "Échéance impayée";
  if (code === "REVIEW") return "Situation à vérifier";
  return "";
}

function viewFromResolved(
  resolved: StudentCardScanResolved,
  extras: Partial<StudentCardScanView> = {},
): StudentCardScanView {
  return {
    studentId: String(resolved.student?.id ?? "").trim(),
    studentName: displayStudentName(resolved.student),
    studentCode: String(resolved.student?.studentCode ?? "").trim(),
    className: String(resolved.class?.className ?? "").trim(),
    attendanceRecorded: false,
    financeLabel: "",
    financeUnavailable: false,
    ...extras,
  };
}

export type StudentCardScanFlowDeps = {
  cardToken: string;
  scope: ScanScopeSnapshot;
  selectedClass: SelectedAttendanceClassRef;
  author: AttendanceAuthorReady;
  attendanceDate: string;
  financeEnabled: boolean;
  isOffline: () => boolean;
  currentScope: () => ScanScopeSnapshot;
  resolveCard: (cardToken: string) => Promise<StudentCardScanResolved>;
  recordAttendance: (
    cardToken: string,
    attendance: { date: string; status: "present"; teacherId?: string },
    idempotencyKey: string,
  ) => Promise<StudentCardScanResolved>;
  readFinance?: (cardToken: string) => Promise<StudentCardScanResolved>;
  createIdempotencyKey: () => string;
};

export async function runStudentCardScanFlow(
  deps: StudentCardScanFlowDeps,
): Promise<StudentCardScanOutcome> {
  if (deps.isOffline()) return { kind: "offline" };
  if (!hasValidSelectedClass(deps.selectedClass)) {
    return { kind: "error", message: STUDENT_CARD_SCAN_COPY.classMismatch };
  }
  const author = isAttendanceAuthorReady(deps.author);
  if (!author.ok) return { kind: "teacher_unresolved" };

  try {
    const resolved = await deps.resolveCard(deps.cardToken);
    if (isStaleScanScope(deps.scope, deps.currentScope())) return { kind: "stale" };
    if (isInvalidCardStatus(resolved.card?.status)) return { kind: "invalid_card" };
    if (!cardBelongsToSelectedClass(resolved.class, deps.selectedClass)) {
      return { kind: "class_mismatch", view: viewFromResolved(resolved) };
    }

    const attendance: { date: string; status: "present"; teacherId?: string } = {
      date: deps.attendanceDate,
      status: "present",
    };
    if (author.teacherId) attendance.teacherId = author.teacherId;
    const idempotencyKey = deps.createIdempotencyKey();
    assertIdempotencyKeySafe(idempotencyKey, deps.cardToken);
    const recorded = await deps.recordAttendance(deps.cardToken, attendance, idempotencyKey);
    if (isStaleScanScope(deps.scope, deps.currentScope())) return { kind: "stale" };

    let financeLabel = "";
    let financeUnavailable = false;
    if (deps.financeEnabled && deps.readFinance) {
      try {
        const finance = await deps.readFinance(deps.cardToken);
        if (isStaleScanScope(deps.scope, deps.currentScope())) return { kind: "stale" };
        financeLabel = financeBadgeLabel(finance.finance);
      } catch {
        if (isStaleScanScope(deps.scope, deps.currentScope())) return { kind: "stale" };
        financeUnavailable = true;
      }
    }

    return {
      kind: "success",
      view: viewFromResolved(recorded.student ? recorded : resolved, {
        attendanceRecorded: true,
        financeLabel,
        financeUnavailable,
      }),
    };
  } catch (error) {
    if (isStaleScanScope(deps.scope, deps.currentScope())) return { kind: "stale" };
    return { kind: "error", message: studentCardScanErrorMessage(error) };
  }
}

export function applyQrConfirmedPresence<T extends { status?: string | null; source?: string; modifiedAt?: string }>(
  attendance: Record<string, T>,
  studentId: string,
): Record<string, T> {
  const key = String(studentId ?? "").trim();
  if (!key) return attendance;
  const current = attendance[key];
  return {
    ...attendance,
    [key]: {
      ...(current ?? ({} as T)),
      status: "Présent",
      source: "postgres",
      modifiedAt: undefined,
    },
  };
}

export function hydrateAfterQrConfirm<T extends { status?: string | null; source?: string; modifiedAt?: string }>(
  current: T | undefined,
  fromPresences: T | undefined,
): T | undefined {
  if (current?.source === "postgres" && current.status === "Présent") {
    if (fromPresences?.source === "draft" && fromPresences.modifiedAt) return current;
    if (fromPresences?.status && fromPresences.source === "postgres") return fromPresences;
    return current;
  }
  return fromPresences ?? current;
}
