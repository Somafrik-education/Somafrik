/**
 * NFC-STATUT-PRESENCE-01 — statuts de l'appel NFC hors connexion lus dans SQLCipher, pour l'écran
 * des présences. Lecture seule : rien n'est écrit, rien n'est envoyé.
 *
 * Seule la dernière session de la classe et du jour est lue. Sont repris :
 *  - les scans rapprochés d'un élève (`card` → Présent) ;
 *  - les corrections explicites de l'enseignant (`manual` → Présent, Retard, Absent).
 * Jamais les anciennes marques `default` (absences déduites avant NFC-APPEL-PARTIEL-01) ni une
 * session expirée. Après synchronisation, les lignes PostgreSQL rechargées font foi : l'écran ne
 * superpose jamais une valeur locale à un statut confirmé par le serveur (applyLocalRollCallMarks).
 */
import type { AttendanceStatus } from "../../../lib/attendanceTruth";
import { findLatestSession, listMarks, type RcContext } from "../store/repository";

const STATUS: Record<string, AttendanceStatus> = { present: "Présent", late: "Retard", absent: "Absent" };

type StudentKeys = { id?: unknown; matricule?: unknown; publicId?: unknown; studentId?: unknown };

function keysOf(student: StudentKeys): string[] {
  return [student.id, student.studentId, student.matricule, student.publicId]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
}

export async function loadLocalRollCallStatuses(
  ctx: RcContext,
  input: { classId: string; date: string; students: readonly StudentKeys[] },
): Promise<Record<string, AttendanceStatus>> {
  const session = await findLatestSession(ctx, input.classId, input.date);
  if (!session || session.state === "expired") return {};
  const marks = await listMarks(ctx, session.session_id);
  // Identifiant de l'élève dans le pack (UUID) → identifiant de la ligne affichée.
  const rowIdByKey = new Map<string, string>();
  for (const student of input.students) {
    const rowId = String(student.id ?? "").trim();
    if (!rowId) continue;
    for (const key of keysOf(student)) rowIdByKey.set(key, rowId);
  }
  const statuses: Record<string, AttendanceStatus> = {};
  for (const mark of marks) {
    if (mark.source !== "card" && mark.source !== "manual") continue;
    const status = STATUS[mark.status];
    const rowId = rowIdByKey.get(String(mark.studentId).toLowerCase());
    if (status && rowId) statuses[rowId] = status;
  }
  return statuses;
}
