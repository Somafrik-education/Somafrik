/**
 * KPI établissement « Présence du jour ».
 * Numérateur = Présent + Retard (convention D3.5 / attendanceTruth).
 * Dénominateur = élèves attendus (inscription active, non archivés, établissement courant).
 * Aucune ligne du jour ≠ présent inventé : appel absent → « — », pas 0 %.
 */
import {
  findTodayPresenceForStudent,
  isAttendedStatus,
  sameAttendanceDay,
  type StudentPresenceIdentity,
} from "./attendanceTruth";
import { normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import { METRIC_PENDING_LABEL } from "./dataTruth";

export const TODAY_PRESENCE_KPI_LABEL = "Présence du jour";
export const DEFAULT_SCHOOL_TIMEZONE = "Africa/Kinshasa";

export type ExpectedStudent = StudentPresenceIdentity & {
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

export type PresenceDayRow = {
  studentId?: string;
  date?: string;
  present?: boolean;
  status?: string;
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

function normalizeStatus(value: unknown): string {
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
  const status = normalizeStatus(student.status ?? student.enrollmentStatus);
  if (status && EXCLUDED_STUDENT_STATUSES.has(status)) return false;
  const expectedSchool = String(schoolCode ?? "").trim();
  const studentSchool = String(student.schoolCode ?? "").trim();
  if (expectedSchool && studentSchool && normalizeStatus(studentSchool) !== normalizeStatus(expectedSchool)) {
    return false;
  }
  const enrolled = String(student.classId ?? student.classCode ?? student.className ?? "").trim();
  return Boolean(enrolled);
}

export function getTodayEstablishmentPresenceKpi(input: {
  students: readonly ExpectedStudent[];
  presences: readonly PresenceDayRow[];
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
    const row = findTodayPresenceForStudent(
      todayPresences.map((item) => ({
        studentId: String(item.studentId ?? ""),
        date: item.date ?? "",
        present: Boolean(item.present),
        status: item.status ?? "",
      })),
      student,
      todayKey,
    );
    if (!row) continue;
    recorded += 1;
    if (isAttendedStatus(normalizePresenceStatus(row))) attended += 1;
  }

  if (!expected.length || recorded === 0) {
    return {
      label: TODAY_PRESENCE_KPI_LABEL,
      value: METRIC_PENDING_LABEL,
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
