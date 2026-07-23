/** Statuts D3.5 — `Justifié` = absence justifiée (pas de double axe). */
export type AttendanceStatus = "Présent" | "Absent" | "Retard" | "Justifié";

export type PresenceRow = {
  studentId?: string;
  present?: boolean;
  status?: string;
  date?: string;
};

export type StudentIdentity = {
  id?: string;
  matricule?: string;
  publicId?: string;
};

export function studentPresenceKeys(student: StudentIdentity) {
  return [student.id, student.matricule, student.publicId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

export function presenceMatchesStudent(presence: Pick<PresenceRow, "studentId">, student: StudentIdentity) {
  const presenceId = String(presence.studentId ?? "").trim();
  return studentPresenceKeys(student).includes(presenceId);
}

/** Identifiant stable pour l'API présences (aligné backend : matricule en priorité). */
export function resolveStudentApiId(student: StudentIdentity) {
  return String(student.matricule ?? student.publicId ?? student.id ?? "").trim();
}

export function normalizePresenceStatus(presence?: Pick<PresenceRow, "present" | "status">): AttendanceStatus {
  if (!presence) return "Absent";

  const status = String(presence.status ?? "").trim().toLowerCase();
  if (["present", "présent", "present."].includes(status)) return "Présent";
  if (["late", "retard"].includes(status)) return "Retard";
  if (["excused", "justifié", "justifie"].includes(status)) return "Justifié";
  if (["absent", "absence"].includes(status)) return "Absent";

  return presence.present ? "Présent" : "Absent";
}

export function getPresenceStats(presences: PresenceRow[]) {
  const present = presences.filter((row) => normalizePresenceStatus(row) === "Présent").length;
  const absent = presences.filter((row) => normalizePresenceStatus(row) === "Absent").length;
  const late = presences.filter((row) => normalizePresenceStatus(row) === "Retard").length;
  const justified = presences.filter((row) => normalizePresenceStatus(row) === "Justifié").length;
  const attended = present + late;

  return {
    total: presences.length,
    present,
    absent,
    late,
    justified,
    attended,
    rate: presences.length ? Math.round((attended / presences.length) * 100) : 0,
  };
}

export function formatAttendanceDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

export function formatAttendanceHour(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function sameAttendanceDay(left?: string, right?: string) {
  return normalizeDateKey(left) === normalizeDateKey(right);
}

function normalizeDateKey(value?: string) {
  const text = String(value ?? "").trim();
  const localMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return text;
}

export function presenceIsAttended(status: AttendanceStatus) {
  return status === "Présent" || status === "Retard";
}

/** Statut initial pour un appel du jour : présent par défaut, sinon dernière saisie. */
export function rollCallInitialStatus(presence?: Pick<PresenceRow, "present" | "status">): AttendanceStatus {
  if (!presence) return "Présent";
  return normalizePresenceStatus(presence);
}

export function findTodayPresenceForStudent(
  presences: PresenceRow[],
  student: StudentIdentity,
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
