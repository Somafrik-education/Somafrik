/**
 * Vérité d'appel Mobile : absence de saisie ≠ présence confirmée.
 * Justifié = absence justifiée (contrat D3.5b), non présent.
 */

import { getPresenceStats, normalizePresenceStatus, type PresenceStats } from "../domain/metrics/schoolMetrics";
import type { PresenceItem } from "../data/catalog";

export type AttendanceStatus = "Présent" | "Absent" | "Retard" | "Justifié";
export type RollCallSource = "unset" | "postgres" | "draft" | "queued" | "failed";

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

/** Aucune ligne du jour → null. Jamais « Présent » inventé. */
export function hydrateRollCallStatus(
  presence?: Pick<PresenceItem, "present" | "status"> | null,
): AttendanceStatus | null {
  if (!presence) return null;
  return normalizePresenceStatus(presence);
}

export function emptyRollCallEntry(): RollCallEntry {
  return { status: null, source: "unset" };
}

export function rollCallEntryFromPresence(
  presence?: Pick<PresenceItem, "present" | "status"> | null,
): RollCallEntry {
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

export function markRosterPresent(
  studentIds: string[],
  current: Record<string, RollCallEntry>,
  actor: string,
  now: Date = new Date(),
): Record<string, RollCallEntry> {
  const next = { ...current };
  for (const studentId of studentIds) {
    next[studentId] = applyRollCallStatus(current[studentId], "Présent", actor, now);
  }
  return next;
}

export function getRollCallDraftStats(
  studentIds: string[],
  attendance: Record<string, RollCallEntry>,
): PresenceStats {
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
  return {
    ...stats,
    total: studentIds.length,
    attended,
    rate: studentIds.length ? Math.round((attended / studentIds.length) * 100) : 0,
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
  return "";
}

export const ROLL_CALL_COPY = {
  unset: "Non saisi",
  draft: "Brouillon — non enregistré",
  queued: "En attente de synchronisation",
  syncError: "Erreur de synchronisation",
  postgres: "Enregistré",
  queuedAlertTitle: "Appel enregistré sur cet appareil — en attente de synchronisation",
  queuedAlertBody:
    "Les présences seront envoyées au serveur dès le retour du réseau. Ceci n'est pas une confirmation PostgreSQL.",
  syncedAlertTitle: "Appel synchronisé",
  persistFailedTitle: "Impossible de conserver cet appel hors connexion",
  persistFailedBody:
    "Impossible de conserver cet appel hors connexion. Réessayez lorsque la connexion est disponible.",
  incompleteSave: "Saisie incomplète",
  incompleteSaveBody:
    "Chaque élève doit avoir un statut explicite avant enregistrement. Utilisez « Tout présent » ou saisissez élève par élève. Aucune présence n'a été envoyée.",
  missingClassIdentity:
    "Identité de classe incomplète (classId et classCode requis). L'appel n'a pas été envoyé.",
} as const;
