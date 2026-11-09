/**
 * Vérité d'appel Mobile.
 * NFC-STATUT-PRESENCE-01 : défaut « Absent » PROVISOIRE (source `unset`) — valeur affichée,
 * jamais écrite sans confirmation explicite de l'enseignant. Un scan NFC enregistré sur le
 * téléphone (source `nfc_local`) affiche « Présent » immédiatement, sans réseau.
 * Justifié = absence justifiée (contrat D3.5b), non présent.
 * Source `unset` = défaut UI, pas une confirmation PostgreSQL.
 * Divergence volontaire avec le Web (défaut « Présent ») : scripts/lot0-parity.test.ts PARITY-001.
 */

import { getPresenceStats, normalizePresenceStatus, type PresenceStats } from "../domain/metrics/schoolMetrics";
import type { PresenceItem } from "../data/catalog";

export type RollCallDraftStats = Omit<PresenceStats, "rate"> & { rate: number | null };

export type AttendanceStatus = "Présent" | "Absent" | "Retard" | "Justifié";
export type RollCallSource = "unset" | "postgres" | "draft" | "queued" | "failed" | "nfc_local";

export type RollCallEntry = {
  status: AttendanceStatus | null;
  source: RollCallSource;
  arrivalTime?: string;
  reason?: string;
  modifiedAt?: string;
  modifiedBy?: string;
  previousStatus?: AttendanceStatus | null;
};

export type StudentPresenceIdentity = {
  id?: string;
  matricule?: string;
  publicId?: string;
};

export function studentPresenceKeys(student: StudentPresenceIdentity) {
  return [student.id, student.matricule, student.publicId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

export function presenceMatchesStudent(
  presence: { studentId?: string },
  student: StudentPresenceIdentity,
) {
  const presenceId = String(presence.studentId ?? "").trim();
  return studentPresenceKeys(student).includes(presenceId);
}

export function formatAttendanceDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

export function formatAttendanceHour(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function normalizeAttendanceDateKey(value?: string) {
  const text = String(value ?? "").trim();
  const localMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return text;
}

export function sameAttendanceDay(left?: string, right?: string) {
  return normalizeAttendanceDateKey(left) === normalizeAttendanceDateKey(right);
}

export function findTodayPresenceForStudent(
  presences: Array<Pick<PresenceItem, "studentId" | "date" | "present" | "status">>,
  student: StudentPresenceIdentity,
  todayLabel: string,
) {
  return [...presences]
    .reverse()
    .find(
      (presence) =>
        presenceMatchesStudent(presence, student) &&
        sameAttendanceDay(String(presence.date ?? ""), todayLabel),
    );
}

/**
 * Aucune ligne du jour → « Absent » provisoire (NFC-STATUT-PRESENCE-01) : affiché, jamais écrit
 * sans confirmation. Une ligne persistée conserve le statut PostgreSQL.
 */
export const PROVISIONAL_STATUS: AttendanceStatus = "Absent";

export function hydrateRollCallStatus(
  presence?: Pick<PresenceItem, "present" | "status"> | null,
): AttendanceStatus | null {
  if (!presence) return PROVISIONAL_STATUS;
  return normalizePresenceStatus(presence);
}

export function emptyRollCallEntry(): RollCallEntry {
  return { status: PROVISIONAL_STATUS, source: "unset" };
}

/** Absence provisoire : valeur d'affichage, jamais une saisie ni une confirmation serveur. */
export function isProvisionalEntry(entry?: Pick<RollCallEntry, "source"> | null): boolean {
  return !entry || entry.source === "unset";
}

export function provisionalStudentIds(studentIds: string[], attendance: Record<string, RollCallEntry>) {
  return studentIds.filter((studentId) => isProvisionalEntry(attendance[studentId]));
}

/**
 * Présence enregistrée par l'appel NFC hors connexion (COMMIT SQLCipher), affichée sans attendre le
 * serveur. Remplace uniquement une absence provisoire ou une valeur NFC locale précédente : jamais
 * un statut confirmé par PostgreSQL (ex. Justifié), une saisie en cours ni un envoi en attente.
 */
export function applyLocalRollCallMarks(
  attendance: Record<string, RollCallEntry>,
  marks: Record<string, AttendanceStatus>,
): Record<string, RollCallEntry> {
  const next = { ...attendance };
  for (const [studentId, status] of Object.entries(marks)) {
    const entry = next[studentId];
    if (entry && entry.source !== "unset" && entry.source !== "nfc_local") continue;
    next[studentId] = { status, source: "nfc_local" };
  }
  for (const [studentId, entry] of Object.entries(next)) {
    // Marque locale disparue (appel corrigé, purgé) : retour à l'absence provisoire.
    if (entry?.source === "nfc_local" && !(studentId in marks)) next[studentId] = emptyRollCallEntry();
  }
  return next;
}

/**
 * Réhydratation depuis PostgreSQL : une valeur NFC locale est conservée tant que le serveur n'a
 * pas de ligne pour l'élève ; dès qu'il en a une (synchronisation réussie), le serveur fait foi.
 */
export function keepLocalRollCallMark(
  entry: Pick<RollCallEntry, "source"> | undefined,
  serverPresence: unknown,
): boolean {
  return entry?.source === "nfc_local" && !serverPresence;
}

export function rollCallEntryFromPresence(
  presence?: Pick<PresenceItem, "present" | "status"> | null,
): RollCallEntry {
  if (!presence) return emptyRollCallEntry();
  const status = hydrateRollCallStatus(presence);
  if (!status) return emptyRollCallEntry();
  return { status, source: "postgres" };
}

export function shouldPreserveLocalAttendanceDraft(entry?: Pick<RollCallEntry, "source" | "modifiedAt"> | null) {
  if (entry?.source === "queued" || entry?.source === "failed") return true;
  return entry?.source === "draft" && Boolean(entry.modifiedAt);
}

export function isAttendedStatus(status: AttendanceStatus | null | undefined) {
  return status === "Présent" || status === "Retard";
}

export function isJustifiedAbsence(status: AttendanceStatus | null | undefined) {
  return status === "Justifié";
}

export function presentFlagForStatus(status: AttendanceStatus) {
  return isAttendedStatus(status);
}

export function applyRollCallStatus(
  current: RollCallEntry | undefined,
  nextStatus: AttendanceStatus,
  actor: string,
  now: Date = new Date(),
): RollCallEntry {
  return {
    status: nextStatus,
    source: "draft",
    previousStatus: current?.status ?? null,
    modifiedBy: actor,
    modifiedAt: `${formatAttendanceDate(now)} ${formatAttendanceHour(now)}`,
    arrivalTime: nextStatus === "Retard" ? formatAttendanceHour(now) : undefined,
    reason: nextStatus === "Justifié" ? "Absence justifiée" : undefined,
  };
}

/**
 * « Tout présent » : déclaration explicite de l'enseignant. Ne remplace jamais un statut confirmé
 * par PostgreSQL autre qu'une absence (Présent, Retard, Justifié conservés) ni une présence NFC
 * locale (déjà « Présent », envoyée par l'appel NFC).
 */
export function markRosterPresent(
  studentIds: string[],
  current: Record<string, RollCallEntry>,
  actor: string,
  now: Date = new Date(),
): Record<string, RollCallEntry> {
  const next = { ...current };
  for (const studentId of studentIds) {
    const entry = current[studentId];
    if (entry?.source === "nfc_local") continue;
    if (entry?.source === "postgres" && entry.status && entry.status !== "Absent") continue;
    next[studentId] = applyRollCallStatus(entry, "Présent", actor, now);
  }
  return next;
}

export function getRollCallDraftStats(
  studentIds: string[],
  attendance: Record<string, RollCallEntry>,
): RollCallDraftStats {
  const rows = studentIds.map((studentId, index) => {
    const status = attendance[studentId]?.status;
    return {
      id: `DRAFT-${index}-${studentId}`,
      publicId: `DRAFT-${index}-${studentId}`,
      studentId,
      date: "",
      present: status ? presentFlagForStatus(status) : false,
      status: status ?? "",
    };
  });
  const selected = rows.filter((row) => row.status);
  const stats = getPresenceStats(selected);
  const attended = studentIds.filter((id) => isAttendedStatus(attendance[id]?.status)).length;
  const recorded = studentIds.filter((id) => Boolean(attendance[id]?.status)).length;
  const complete = studentIds.length > 0 && recorded === studentIds.length;
  return {
    ...stats,
    total: studentIds.length,
    attended,
    rate: complete ? Math.round((attended / studentIds.length) * 100) : studentIds.length ? null : 0,
  };
}

export function unsetStudentIds(
  studentIds: string[],
  attendance: Record<string, RollCallEntry>,
) {
  return studentIds.filter((studentId) => !attendance[studentId]?.status);
}

export function assertRollCallReadyToSave(
  studentIds: string[],
  attendance: Record<string, RollCallEntry>,
): { ok: true } | { ok: false; missingIds: string[] } {
  const missingIds = unsetStudentIds(studentIds, attendance);
  if (missingIds.length) return { ok: false, missingIds };
  return { ok: true };
}

export function lastDraftStatus<T extends { status?: AttendanceStatus | null }>(entries: T[]) {
  return entries.filter((entry) => entry.status).at(-1)?.status ?? null;
}

export function resolveClassCourseLabel(courses: string[]) {
  const named = courses.map((course) => String(course ?? "").trim()).filter(Boolean);
  return named.length ? named.join(", ") : "Cours non renseignés";
}

export function confirmRollCallEntries(
  attendance: Record<string, RollCallEntry>,
  studentIds: string[],
): Record<string, RollCallEntry> {
  const next = { ...attendance };
  for (const studentId of studentIds) {
    const entry = next[studentId];
    if (!entry?.status) continue;
    next[studentId] = {
      ...entry,
      source: "postgres",
      modifiedAt: undefined,
      modifiedBy: undefined,
      previousStatus: undefined,
    };
  }
  return next;
}

export function markRollCallSyncState(
  attendance: Record<string, RollCallEntry>,
  studentIds: string[],
  source: Extract<RollCallSource, "queued" | "failed">,
): Record<string, RollCallEntry> {
  const next = { ...attendance };
  for (const studentId of studentIds) {
    const entry = next[studentId];
    if (!entry?.status) continue;
    next[studentId] = { ...entry, source };
  }
  return next;
}

export function rollCallSourceLabel(source: RollCallSource | undefined) {
  if (source === "queued") return ROLL_CALL_COPY.queued;
  if (source === "failed") return ROLL_CALL_COPY.syncError;
  if (source === "postgres") return ROLL_CALL_COPY.postgres;
  if (source === "draft") return ROLL_CALL_COPY.draft;
  if (source === "nfc_local") return ROLL_CALL_COPY.nfcLocal;
  if (source === "unset") return ROLL_CALL_COPY.provisional;
  return "";
}

export type RollCallQueuedCause =
  | "device_offline"
  | "backend_unreachable"
  | "timeout"
  | "backend_5xx"
  | "unconfirmed";

export function rollCallQueuedAlertBody(cause: RollCallQueuedCause) {
  if (cause === "device_offline") return ROLL_CALL_COPY.queuedAlertBodyOffline;
  if (cause === "timeout") return ROLL_CALL_COPY.queuedAlertBodyTimeout;
  if (cause === "backend_5xx") return ROLL_CALL_COPY.queuedAlertBodyServer;
  if (cause === "backend_unreachable") return ROLL_CALL_COPY.queuedAlertBodyUnreachable;
  return ROLL_CALL_COPY.queuedAlertBody;
}

export const ROLL_CALL_COPY = {
  unset: "Non saisi",
  provisional: "Absent provisoire — non enregistré",
  nfcLocal: "Carte scannée — enregistrée sur ce téléphone",
  confirmAbsencesTitle: "Confirmer les absences",
  confirmAbsencesBody: (count: number) =>
    `${count} élève(s) n'ont ni carte scannée ni statut saisi : ils sont affichés « Absent » de façon provisoire.\nConfirmez-vous leur absence ?`,
  confirmAbsences: "Confirmer les absences",
  saveWithoutProvisional: "Enregistrer sans eux",
  cancel: "Annuler",
  nothingToSave: "Aucun statut à enregistrer : les élèves restent en absence provisoire.",
  draft: "Brouillon — non enregistré",
  queued: "En attente de synchronisation",
  syncError: "Erreur de synchronisation",
  postgres: "Enregistré",
  queuedAlertTitle: "Appel enregistré sur cet appareil — en attente de synchronisation",
  queuedAlertBody:
    "Les présences sont conservées en file d'attente. La confirmation PostgreSQL n'est pas encore disponible. Ceci n'est pas une preuve d'absence de réseau.",
  queuedAlertBodyOffline:
    "Les présences seront envoyées au serveur dès le retour du réseau. Ceci n'est pas une confirmation PostgreSQL.",
  queuedAlertBodyTimeout:
    "Le délai d'attente a expiré. Les présences seront renvoyées avec la même clé d'idempotence. Ceci n'est pas une confirmation PostgreSQL, ni une preuve d'absence de réseau.",
  queuedAlertBodyServer:
    "Le serveur est indisponible. Les présences sont conservées en file d'attente. Ceci n'est pas une preuve d'absence de réseau.",
  queuedAlertBodyUnreachable:
    "Le serveur n'a pas pu être joint. Les présences sont conservées en file d'attente. Ceci n'est pas une confirmation PostgreSQL.",
  syncedAlertTitle: "Appel synchronisé",
  persistFailedTitle: "Impossible de conserver cet appel hors connexion",
  persistFailedBody:
    "Impossible de conserver cet appel hors connexion. Réessayez lorsque la connexion est disponible.",
  incompleteSave: "Saisie incomplète",
  incompleteSaveBody:
    "Chaque élève doit avoir un statut explicite avant enregistrement. Utilisez « Tout présent » ou saisissez élève par élève. Aucune présence n'a été envoyée.",
  missingClassIdentity:
    "Identité de classe incomplète (classId et classCode requis). L'appel n'a pas été envoyé.",
  outboxUnavailable: "Synchronisation indisponible",
  outboxUnavailableBody:
    "File d'attente illisible — confirmation serveur non déterminée. L'appel n'est pas considéré comme vide ni comme enregistré.",
  sendingLockTitle: "Synchronisation en cours",
  sendingLockBody:
    "Cet appel est en cours d'envoi. Attendez la confirmation avant d'enregistrer une nouvelle modification.",
} as const;
