/**
 * Badge « Présence » de la liste Classes.
 *
 * Période canonique = jour civil de l'établissement (même fuseau que
 * todayPresenceKpi). Ce n'est PAS une moyenne historique. Si le produit
 * veut une moyenne, le libellé devra dire « Présence moyenne » + période.
 *
 * Contrat visuel :
 * - 0 élève attendu → « Présence — », jamais un pourcentage
 * - élèves mais aucun appel confirmé aujourd'hui → « Non saisi », jamais 0 %
 * - appel confirmé aujourd'hui (recorded === expected) → taux du jour
 * - ligne absente ≠ élève absent
 * - Présent + Retard = assistés ; Absent + Justifié = non assistés
 * - scope : classId actif + date du jour + tenant
 */
import type { SchoolClass, Student } from "../data/catalog";
import {
  findTodayPresenceForStudent,
  isAttendedStatus,
  sameAttendanceDay,
} from "./attendanceTruth";
import { filterStudentsByClassIdentity } from "./attendanceClassIdentity";
import { normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import {
  METRIC_PENDING_LABEL,
  METRIC_UNAVAILABLE_LABEL,
  type ResourceSnapshot,
} from "./dataTruth";
import {
  civilDateKeyInTimeZone,
  isExpectedStudentForToday,
  type ExpectedStudent,
  type PresenceDayRow,
} from "./todayPresenceKpi";

export const CLASS_TODAY_PRESENCE_PERIOD = "today" as const;
export const CLASS_UNSET_PRESENCE_LABEL = "Non saisi";
export const CLASS_EMPTY_PRESENCE_BADGE = `Présence ${METRIC_PENDING_LABEL}`;

export type ClassPresenceRow = PresenceDayRow & {
  schoolId?: string | null;
  schoolCode?: string | null;
  classId?: string | null;
  classCode?: string | null;
};

export type ClassTodayPresenceKind = "empty" | "unset" | "rate" | "pending" | "unavailable";

export type ClassTodayPresenceBadge = {
  kind: ClassTodayPresenceKind;
  period: typeof CLASS_TODAY_PRESENCE_PERIOD;
  periodKey: string;
  badgeText: string;
  value: string;
  rate: number | null;
  expected: number;
  recorded: number;
  attended: number;
  studentIds: string[];
};

function asRef(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown): string {
  return asRef(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function snapshotGate(snapshot: ResourceSnapshot<unknown>): ClassTodayPresenceKind | null {
  if (snapshot.status === "idle" || snapshot.status === "loading") return "pending";
  if (snapshot.status === "error") return "unavailable";
  if (snapshot.status === "offline" && !snapshot.data.length) return "unavailable";
  return null;
}

function pendingBadge(periodKey: string): ClassTodayPresenceBadge {
  return {
    kind: "pending",
    period: CLASS_TODAY_PRESENCE_PERIOD,
    periodKey,
    badgeText: CLASS_EMPTY_PRESENCE_BADGE,
    value: METRIC_PENDING_LABEL,
    rate: null,
    expected: 0,
    recorded: 0,
    attended: 0,
    studentIds: [],
  };
}

function unavailableBadge(periodKey: string): ClassTodayPresenceBadge {
  return {
    kind: "unavailable",
    period: CLASS_TODAY_PRESENCE_PERIOD,
    periodKey,
    badgeText: `Présence ${METRIC_UNAVAILABLE_LABEL}`,
    value: METRIC_UNAVAILABLE_LABEL,
    rate: null,
    expected: 0,
    recorded: 0,
    attended: 0,
    studentIds: [],
  };
}

function presenceBelongsToSchool(row: ClassPresenceRow, schoolCode?: string | null) {
  const expected = asRef(schoolCode);
  if (!expected) return false;
  const rowSchool = asRef(row.schoolCode);
  if (!rowSchool) return false;
  return normalizeKey(rowSchool) === normalizeKey(expected);
}

function presenceBelongsToClass(
  row: ClassPresenceRow,
  schoolClass: Pick<SchoolClass, "id" | "publicId" | "classCode">,
) {
  const classId = asRef(schoolClass.id);
  const rowClassId = asRef(row.classId);
  if (classId && rowClassId) return rowClassId === classId;
  const classCode = asRef(schoolClass.classCode || schoolClass.publicId);
  const rowClassCode = asRef(row.classCode);
  if (classCode && rowClassCode) return rowClassCode === classCode;
  return false;
}

function studentBelongsToSchool(student: ExpectedStudent, schoolCode?: string | null) {
  const expected = asRef(schoolCode);
  if (!expected) return false;
  const studentSchool = asRef(student.schoolCode);
  if (!studentSchool) return false;
  return normalizeKey(studentSchool) === normalizeKey(expected);
}

export function classPresenceBadgeTestId(classRef: { id?: string; name?: string }) {
  const slug = asRef(classRef.id || classRef.name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `class-presence-badge-${slug}`;
}

export function resolveClassTodayPresenceBadge(input: {
  studentsSnapshot: ResourceSnapshot<unknown>;
  presencesSnapshot: ResourceSnapshot<ClassPresenceRow>;
  students: readonly ExpectedStudent[];
  classes?: SchoolClass[];
  schoolClass: Pick<SchoolClass, "id" | "publicId" | "classCode" | "name">;
  schoolCode?: string | null;
  timeZone?: string | null;
  now?: Date;
}): ClassTodayPresenceBadge {
  const periodKey = civilDateKeyInTimeZone(input.now ?? new Date(), input.timeZone);
  const studentsGate = snapshotGate(input.studentsSnapshot);
  if (studentsGate === "pending") return pendingBadge(periodKey);
  if (studentsGate === "unavailable") return unavailableBadge(periodKey);

  const identityStudents = filterStudentsByClassIdentity(
    input.students as Student[],
    {
      classId: asRef(input.schoolClass.id),
      classCode: asRef(input.schoolClass.classCode || input.schoolClass.publicId),
      className: asRef(input.schoolClass.name),
    },
    input.classes ?? [],
  );
  const expectedStudents = identityStudents.filter(
    (student) =>
      studentBelongsToSchool(student, input.schoolCode) &&
      isExpectedStudentForToday(student, input.schoolCode),
  );
  const studentIds = expectedStudents.map((student) => asRef(student.id)).filter(Boolean);

  if (!expectedStudents.length) {
    return {
      kind: "empty",
      period: CLASS_TODAY_PRESENCE_PERIOD,
      periodKey,
      badgeText: CLASS_EMPTY_PRESENCE_BADGE,
      value: METRIC_PENDING_LABEL,
      rate: null,
      expected: 0,
      recorded: 0,
      attended: 0,
      studentIds: [],
    };
  }

  const presencesGate = snapshotGate(input.presencesSnapshot);
  if (presencesGate === "pending") {
    return { ...pendingBadge(periodKey), expected: expectedStudents.length, studentIds };
  }
  if (presencesGate === "unavailable") {
    return { ...unavailableBadge(periodKey), expected: expectedStudents.length, studentIds };
  }

  const todayRows = input.presencesSnapshot.data.filter(
    (row) =>
      sameAttendanceDay(row.date, periodKey) &&
      presenceBelongsToSchool(row, input.schoolCode) &&
      presenceBelongsToClass(row, input.schoolClass),
  );

  let recorded = 0;
  let attended = 0;
  for (const student of expectedStudents) {
    const row = findTodayPresenceForStudent(
      todayRows.map((item) => ({
        studentId: String(item.studentId ?? ""),
        date: item.date ?? "",
        present: Boolean(item.present),
        status: item.status ?? "",
      })),
      student,
      periodKey,
    );
    if (!row) continue;
    recorded += 1;
    if (isAttendedStatus(normalizePresenceStatus(row))) attended += 1;
  }

  if (recorded !== expectedStudents.length) {
    return {
      kind: "unset",
      period: CLASS_TODAY_PRESENCE_PERIOD,
      periodKey,
      badgeText: CLASS_UNSET_PRESENCE_LABEL,
      value: CLASS_UNSET_PRESENCE_LABEL,
      rate: null,
      expected: expectedStudents.length,
      recorded,
      attended,
      studentIds,
    };
  }

  const rate = Math.round((attended / expectedStudents.length) * 100);
  return {
    kind: "rate",
    period: CLASS_TODAY_PRESENCE_PERIOD,
    periodKey,
    badgeText: `Présence ${rate} %`,
    value: `${rate} %`,
    rate,
    expected: expectedStudents.length,
    recorded,
    attended,
    studentIds,
  };
}
