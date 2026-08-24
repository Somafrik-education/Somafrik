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

export const TODAY_PRESENCE_KPI_LABEL = "Présence du jour";
export const DEFAULT_SCHOOL_TIMEZONE = "Africa/Kinshasa";

export type ExpectedStudent = StudentIdentity & {
  schoolCode?: string | null;
  classId?: string | null;
  classCode?: string | null;
  className?: string | null;
  archived?: boolean | null;
  archivedAt?: string | null;
  archived_at?: string | null;
  status?: string | null;
  enrollmentStatus?: string | null;
};

export type TodayPresenceKpi = {
  label: string;
  value: string;
  rate: number | null;
  expected: number;
  attended: number;
  recorded: number;
};

const EXCLUDED_STUDENT_STATUSES = new Set([
  "archived",
  "archive",
  "archivee",
  "inactive",
  "inactif",
  "disabled",
  "desactive",
  "deleted",
  "supprime",
  "desinscrit",
  "unenrolled",
  "transfere",
  "transferred",
  "sorti",
]);

function normalizeStudentStatus(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function resolveSchoolTimeZone(raw?: string | null): string {
  const tz = String(raw ?? "").trim();
  if (!tz) return DEFAULT_SCHOOL_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_SCHOOL_TIMEZONE;
  }
}

export function civilDateKeyInTimeZone(now: Date, timeZone?: string | null): string {
  const tz = resolveSchoolTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isExpectedStudentForToday(
  student: ExpectedStudent,
  schoolCode?: string | null,
): boolean {
  if (student.archived === true) return false;
  if (student.archivedAt || student.archived_at) return false;
  const status = normalizeStudentStatus(student.status ?? student.enrollmentStatus);
  if (status && EXCLUDED_STUDENT_STATUSES.has(status)) return false;
  const expectedSchool = String(schoolCode ?? "").trim();
  const studentSchool = String(student.schoolCode ?? "").trim();
  if (
    expectedSchool &&
    studentSchool &&
    normalizeStudentStatus(studentSchool) !== normalizeStudentStatus(expectedSchool)
  ) {
    return false;
  }
  const enrolled = String(student.classId ?? student.classCode ?? student.className ?? "").trim();
  return Boolean(enrolled);
}

export function getTodayEstablishmentPresenceKpi(input: {
  students: readonly ExpectedStudent[];
  presences: readonly PresenceRow[];
  schoolCode?: string | null;
  timeZone?: string | null;
  now?: Date;
}): TodayPresenceKpi {
  const todayKey = civilDateKeyInTimeZone(input.now ?? new Date(), input.timeZone);
  const expected = input.students.filter((student) => isExpectedStudentForToday(student, input.schoolCode));
  const todayPresences = input.presences.filter((row) => sameAttendanceDay(row.date, todayKey));

  let recorded = 0;
  let attended = 0;
  for (const student of expected) {
    const row = findTodayPresenceForStudent(todayPresences, student, todayKey);
    if (!row) continue;
    recorded += 1;
    if (presenceIsAttended(normalizePresenceStatus(row))) attended += 1;
  }

  if (!expected.length || recorded === 0) {
    return {
      label: TODAY_PRESENCE_KPI_LABEL,
      value: "—",
      rate: null,
      expected: expected.length,
      attended: 0,
      recorded: 0,
    };
  }

  const rate = Math.round((attended / expected.length) * 100);
  return {
    label: TODAY_PRESENCE_KPI_LABEL,
    value: `${rate} %`,
    rate,
    expected: expected.length,
    attended,
    recorded,
  };
}
