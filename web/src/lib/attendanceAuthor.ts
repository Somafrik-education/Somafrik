/** Acteur administratif ≠ enseignant pédagogique (appel Web). */

type Row = Record<string, unknown>;

function asRef(value: unknown) {
  return String(value ?? "").trim();
}

function isTeacherRole(role?: string) {
  return String(role ?? "").trim() === "Enseignant";
}

function isActiveAssignment(status: unknown) {
  const normalized = asRef(status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized) return false;
  return ["active", "actif", "open", "ouverte"].includes(normalized);
}

export const ATTENDANCE_PEDAGOGICAL_TEACHER_COPY = {
  none: "Aucun enseignant n'est affecté à cette classe. Vérifiez l'affectation du cours.",
  needSelection: "Plusieurs enseignants sont affectés à cette classe. Choisissez l'enseignant pédagogique.",
};

export type AttendanceTeacherOption = {
  teacherId: string;
  label: string;
};

export function assignmentMatchesClass(
  assignment: Row,
  identity: { classId?: string | null; classCode?: string | null } | null | undefined,
) {
  if (!identity) return false;
  const selectedId = asRef(identity.classId);
  const selectedCode = asRef(identity.classCode);
  const assignmentId = asRef(assignment.classId ?? assignment.class_id);
  if (assignmentId) return Boolean(selectedId) && assignmentId === selectedId;
  const assignmentCode = asRef(assignment.classCode ?? assignment.class_code);
  if (assignmentCode) return Boolean(selectedCode) && assignmentCode === selectedCode;
  return false;
}

function teacherKey(row: Row) {
  return asRef(row.teacherId ?? row.teacherCode ?? row.teacher_id ?? row.teacher_code);
}

function teacherLabel(row: Row, teachers: Row[]) {
  const named = asRef(row.teacherName);
  if (named) return named;
  const key = teacherKey(row);
  const catalog = teachers.find(
    (teacher) =>
      asRef(teacher.id) === key ||
      asRef(teacher.publicId) === key ||
      asRef(teacher.teacherCode) === key,
  );
  const fromCatalog =
    asRef(catalog?.name) || `${asRef(catalog?.firstName)} ${asRef(catalog?.lastName)}`.trim();
  return fromCatalog || key;
}

export function pedagogicalAttendanceTeacherOptions(
  assignments: Row[],
  identity: { classId?: string | null; classCode?: string | null } | null | undefined,
  teachers: Row[] = [],
): AttendanceTeacherOption[] {
  const seen = new Set<string>();
  const options: AttendanceTeacherOption[] = [];
  for (const assignment of assignments) {
    if (!isActiveAssignment(assignment.status ?? assignment.assignmentStatus)) continue;
    if (!assignmentMatchesClass(assignment, identity)) continue;
    const id = teacherKey(assignment);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({ teacherId: id, label: teacherLabel(assignment, teachers) });
  }
  return options;
}

export type AttendanceTeacherDecision =
  | { status: "teacher_session" }
  | { status: "auto"; teacherId: string }
  | { status: "need_selection"; options: AttendanceTeacherOption[] }
  | { status: "selected"; teacherId: string }
  | { status: "blocked"; message: string };

export function resolvePedagogicalAttendanceTeacher(input: {
  role?: string;
  assignments?: Row[];
  identity: { classId?: string | null; classCode?: string | null } | null;
  teachers?: Row[];
  selectedTeacherId?: string;
}): AttendanceTeacherDecision {
  if (isTeacherRole(input.role)) return { status: "teacher_session" };
  const options = pedagogicalAttendanceTeacherOptions(
    input.assignments ?? [],
    input.identity,
    input.teachers ?? [],
  );
  if (!options.length) {
    return { status: "blocked", message: ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.none };
  }
  if (options.length === 1) {
    return { status: "auto", teacherId: options[0].teacherId };
  }
  const selected = asRef(input.selectedTeacherId);
  if (selected && options.some((option) => option.teacherId === selected)) {
    return { status: "selected", teacherId: selected };
  }
  return { status: "need_selection", options };
}

export function explicitAttendanceTeacherId(decision: AttendanceTeacherDecision): string | undefined {
  if (decision.status === "auto" || decision.status === "selected") return decision.teacherId;
  return undefined;
}

export function attachAttendanceTeacherToPayload<T extends { items?: unknown[] }>(
  payload: T,
  teacherId?: string,
): T {
  const key = asRef(teacherId);
  if (!key) return payload;
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) =>
        item && typeof item === "object" ? { ...(item as Record<string, unknown>), teacherId: key } : item,
      )
    : payload.items;
  return { ...payload, teacherId: key, items };
}
