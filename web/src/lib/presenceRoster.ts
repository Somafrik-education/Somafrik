/** Cartes et sélection Présences — identité classId / classCode, jamais className. */

export type PresenceClassCard = {
  classId: string;
  classCode: string;
  className: string;
  studentCount: number;
};

type Row = Record<string, unknown>;

function asRef(value: unknown) {
  return String(value ?? "").trim();
}

function isTeacherRole(role?: string) {
  return String(role ?? "").trim() === "Enseignant";
}

function isActiveAssignmentStatus(status: unknown) {
  const normalized = asRef(status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized) return true;
  return ["active", "actif", "open", "ouverte"].includes(normalized);
}

export function toPresenceClassCard(row: Row): PresenceClassCard | null {
  const classCode = asRef(row.classCode ?? row.publicId ?? row.class_code);
  const classId = asRef(row.classId ?? row.class_id ?? row.id);
  if (!classCode || !classId) return null;
  return {
    classId,
    classCode,
    className: asRef(row.className ?? row.name) || classCode,
    studentCount: Number(row.students ?? row.studentCount ?? 0) || 0,
  };
}

function teacherIdentityKeys(user: Row | null | undefined, teacher: Row | null | undefined) {
  const keys = new Set<string>();
  for (const value of [
    teacher?.id,
    teacher?.teacherCode,
    teacher?.publicId,
    teacher?.identifier,
    teacher?.userId,
    user?.id,
    user?.identifier,
    user?.publicId,
    user?.teacherCode,
  ]) {
    const key = asRef(value);
    if (key) keys.add(key);
  }
  return keys;
}

function collectAssignedClassRefs(input: {
  assignments?: Row[];
  teacherRecord?: Row | null;
  currentUser?: Row | null;
}) {
  const classIds = new Set<string>();
  const classCodes = new Set<string>();
  const extras: PresenceClassCard[] = [];
  const teacherKeys = teacherIdentityKeys(input.currentUser, input.teacherRecord);
  const add = (assignment: Row) => {
    if (!isActiveAssignmentStatus(assignment.status ?? assignment.assignmentStatus)) {
      return;
    }
    const classId = asRef(assignment.classId ?? assignment.class_id);
    const classCode = asRef(assignment.classCode ?? assignment.class_code);
    if (classId) classIds.add(classId);
    if (classCode) classCodes.add(classCode);
    if (classId || classCode) {
      extras.push({
        classId: classId || classCode,
        classCode: classCode || classId,
        className: asRef(assignment.className ?? assignment.class_name) || classCode || classId,
        studentCount: 0,
      });
    }
  };

  for (const assignment of input.assignments ?? []) {
    const teacherId = asRef(assignment.teacherId ?? assignment.teacherCode ?? assignment.teacher_id);
    if (teacherKeys.size && teacherId && !teacherKeys.has(teacherId)) {
      continue;
    }
    add(assignment);
  }

  const embedded = input.teacherRecord?.assignments;
  if (Array.isArray(embedded)) {
    embedded.forEach((item) => add(item as Row));
  }

  return { classIds, classCodes, extras };
}

function cardKey(card: PresenceClassCard) {
  return card.classId || card.classCode;
}

/**
 * Construit les cartes Présences. Deux classes homonymes restent deux cartes.
 * L'enseignant n'est scopé que par teacher_assignments.class_id / classCode.
 */
export function buildPresenceClassCards(input: {
  role?: string;
  classes?: Row[];
  assignments?: Row[];
  teacherRecord?: Row | null;
  currentUser?: Row | null;
}): PresenceClassCard[] {
  const fromClasses = (input.classes ?? [])
    .map((row) => toPresenceClassCard(row))
    .filter((row): row is PresenceClassCard => Boolean(row));

  const byKey = new Map<string, PresenceClassCard>();
  for (const card of fromClasses) {
    byKey.set(cardKey(card), card);
  }

  if (isTeacherRole(input.role)) {
    const assigned = collectAssignedClassRefs(input);
    if (!assigned.classIds.size && !assigned.classCodes.size) {
      return [];
    }
    for (const extra of assigned.extras) {
      const key = cardKey(extra);
      if (!byKey.has(key)) {
        byKey.set(key, extra);
      }
    }
    return [...byKey.values()]
      .filter(
        (card) => assigned.classIds.has(card.classId) || assigned.classCodes.has(card.classCode),
      )
      .sort((left, right) => left.className.localeCompare(right.className, "fr"));
  }

  return [...byKey.values()].sort((left, right) => left.className.localeCompare(right.className, "fr"));
}

export function findPresenceClassCard(
  cards: PresenceClassCard[],
  selected: { classId?: string | null; classCode?: string | null } | null,
): PresenceClassCard | null {
  if (!selected) return null;
  const classId = asRef(selected.classId);
  const classCode = asRef(selected.classCode);
  return (
    cards.find((card) => classId && card.classId === classId) ??
    cards.find((card) => classCode && card.classCode === classCode) ??
    null
  );
}
