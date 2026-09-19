/**
 * Badge « Présence » des cartes classe Web.
 *
 * Contrat fail-closed aligné sur Mobile/src/lib/classTodayPresenceBadge.ts :
 * - 0 élève attendu → « Présence — », jamais un pourcentage
 * - roster attendu indisponible / incomplet / recorded !== expected → « Non saisi »
 * - chaque élève attendu a une ligne du jour → « Présence N % » (Présent + Retard)
 * - lignes hors roster (élève historique, doublon) ignorées ; elles ne rendent jamais l'appel complet
 */
import {
  findTodayPresenceForStudent,
  isExpectedStudentForToday,
  normalizePresenceStatus,
  presenceIsAttended,
  type ExpectedStudent,
  type PresenceRow,
  type StudentIdentity,
} from "./presenceMetrics";

export const CLASS_UNSET_PRESENCE_LABEL = "Non saisi";
export const CLASS_EMPTY_PRESENCE_BADGE = "Présence —";

export type ClassTodayPresenceKind = "empty" | "unset" | "rate";

export type ClassTodayPresenceBadge = {
  kind: ClassTodayPresenceKind;
  badgeText: string;
  rate: number | null;
  expected: number;
  recorded: number;
  attended: number;
};

function emptyBadge(): ClassTodayPresenceBadge {
  return {
    kind: "empty",
    badgeText: CLASS_EMPTY_PRESENCE_BADGE,
    rate: null,
    expected: 0,
    recorded: 0,
    attended: 0,
  };
}

function unsetBadge(expected: number, recorded: number, attended: number): ClassTodayPresenceBadge {
  return {
    kind: "unset",
    badgeText: CLASS_UNSET_PRESENCE_LABEL,
    rate: null,
    expected,
    recorded,
    attended,
  };
}

/** Complétude numérique : recorded !== expected est toujours fail-closed. */
export function formatClassTodayPresenceBadge(input: {
  expected: number;
  recorded: number;
  attended: number;
}): ClassTodayPresenceBadge {
  const expected = Math.max(0, Number(input.expected) || 0);
  const recorded = Math.max(0, Number(input.recorded) || 0);
  const attended = Math.max(0, Number(input.attended) || 0);

  if (expected <= 0) return emptyBadge();
  if (recorded !== expected) return unsetBadge(expected, recorded, attended);

  const rate = Math.min(100, Math.round((attended / expected) * 100));
  return {
    kind: "rate",
    badgeText: `Présence ${rate} %`,
    rate,
    expected,
    recorded,
    attended,
  };
}

function asRef(value: unknown) {
  return String(value ?? "").trim();
}

export function studentBelongsToPresenceCard(
  student: { classId?: unknown; class_id?: unknown; classCode?: unknown; class_code?: unknown },
  card: { classId?: string; classCode?: string },
) {
  const studentClassId = asRef(student.classId ?? student.class_id);
  const studentClassCode = asRef(student.classCode ?? student.class_code);
  const classId = asRef(card.classId);
  const classCode = asRef(card.classCode);
  if (studentClassId && classId && studentClassId === classId) return true;
  if (studentClassCode && classCode && studentClassCode === classCode) return true;
  return false;
}

/**
 * Roster attendu pour une carte classe.
 * `null` = identités non fiables (hydratation partielle vs studentCount) → fail-closed.
 */
export function resolveExpectedStudentsForClassCard<T extends ExpectedStudent>(input: {
  studentCount: number;
  students: readonly T[];
  classId?: string;
  classCode?: string;
}): T[] | null {
  if (input.studentCount <= 0) return [];
  const roster = input.students.filter(
    (student) => studentBelongsToPresenceCard(student, input) && isExpectedStudentForToday(student),
  );
  if (roster.length !== input.studentCount) return null;
  return roster;
}

export function resolveClassTodayPresenceBadge(input: {
  expectedStudents: readonly StudentIdentity[] | null;
  todayRows: readonly PresenceRow[];
  todayLabel: string;
}): ClassTodayPresenceBadge {
  if (input.expectedStudents == null) {
    return unsetBadge(0, 0, 0);
  }
  if (input.expectedStudents.length === 0) return emptyBadge();

  let recorded = 0;
  let attended = 0;
  for (const student of input.expectedStudents) {
    const row = findTodayPresenceForStudent(input.todayRows as PresenceRow[], student, input.todayLabel);
    if (!row) continue;
    recorded += 1;
    if (presenceIsAttended(normalizePresenceStatus(row))) attended += 1;
  }

  return formatClassTodayPresenceBadge({
    expected: input.expectedStudents.length,
    recorded,
    attended,
  });
}
