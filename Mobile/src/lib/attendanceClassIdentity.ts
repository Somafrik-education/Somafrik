/**
 * Identité de classe pour l'appel Mobile : classId + classCode, jamais className comme clé.
 */
import type { SchoolClass, Student } from "../data/catalog";
import {
  classNameMatches,
  filterStudentsByClassName,
  isCanonicalActiveAssignment,
  isTeacherSession,
  listCanonicalTeacherAssignments,
  teacherScopedClassNames,
  type TeacherScopeState,
} from "./establishment";

export type AttendanceClassIdentity = {
  classId: string;
  classCode: string;
  className: string;
};

function asRef(value: unknown) {
  return String(value ?? "").trim();
}

export function classIdentityKey(identity: Pick<AttendanceClassIdentity, "classId" | "classCode">) {
  const classId = asRef(identity.classId);
  if (classId) return `id:${classId}`;
  return `code:${asRef(identity.classCode)}`;
}

export function lookupClassCatalogIdentity(
  classes: SchoolClass[],
  ref: { classId?: string | null; classCode?: string; className?: string },
): AttendanceClassIdentity | null {
  const classId = asRef(ref.classId);
  const classCode = asRef(ref.classCode);
  const byId = classId
    ? classes.find((row) => asRef(row.id) === classId || asRef(row.publicId) === classId)
    : undefined;
  const byCode = classCode
    ? classes.find((row) => asRef(row.classCode) === classCode || asRef(row.publicId) === classCode)
    : undefined;
  const row = byId ?? byCode;
  if (row) {
    const resolvedId = asRef(row.id) || classId;
    const resolvedCode = asRef(row.classCode) || asRef(row.publicId) || classCode;
    const resolvedName = asRef(row.name) || asRef(ref.className);
    if (resolvedId && resolvedCode) {
      return { classId: resolvedId, classCode: resolvedCode, className: resolvedName };
    }
  }
  const name = asRef(ref.className);
  if (!name) return null;
  const named = classes.filter((row) => classNameMatches(row.name, name));
  if (named.length !== 1) return null;
  const resolvedId = asRef(named[0].id);
  const resolvedCode = asRef(named[0].classCode) || asRef(named[0].publicId);
  if (!resolvedId || !resolvedCode) return null;
  return { classId: resolvedId, classCode: resolvedCode, className: asRef(named[0].name) || name };
}

export function resolveStudentClassIdentity(
  student: Pick<Student, "classId" | "classCode" | "className">,
  classes: SchoolClass[] = [],
): AttendanceClassIdentity | null {
  const classId = asRef(student.classId);
  const classCode = asRef(student.classCode);
  if (classId && classCode) {
    return {
      classId,
      classCode,
      className: asRef(student.className),
    };
  }
  return lookupClassCatalogIdentity(classes, student);
}

function rememberAttendanceClass(
  byKey: Map<string, AttendanceClassIdentity>,
  identity: AttendanceClassIdentity,
) {
  const key = identity.classId || identity.classCode
    ? classIdentityKey(identity)
    : `name:${identity.className.toLowerCase()}`;
  if (!byKey.has(key)) byKey.set(key, identity);
}

export function listScopedAttendanceClasses(
  students: Student[],
  classes: SchoolClass[] = [],
  session?: { role?: string; user?: Record<string, unknown> } | null,
  state?: TeacherScopeState,
): AttendanceClassIdentity[] {
  const byKey = new Map<string, AttendanceClassIdentity>();
  for (const student of students) {
    const identity = resolveStudentClassIdentity(student, classes);
    if (identity) {
      rememberAttendanceClass(byKey, identity);
      continue;
    }
    const className = asRef(student.className);
    if (!className) continue;
    rememberAttendanceClass(byKey, { classId: "", classCode: "", className });
  }

  const scopedKeys = session ? teacherScopedClassNames(session, state) : null;
  if (scopedKeys) {
    for (const assignment of listCanonicalTeacherAssignments(session ?? null, state)) {
      const identity = lookupClassCatalogIdentity(classes, {
        classId: assignment.classId,
        classCode: assignment.classCode,
        className: assignment.className,
      });
      if (identity) {
        rememberAttendanceClass(byKey, identity);
        continue;
      }
      const className = asRef(assignment.className);
      if (!className) continue;
      rememberAttendanceClass(byKey, {
        classId: asRef(assignment.classId),
        classCode: asRef(assignment.classCode),
        className,
      });
    }
  }

  return [...byKey.values()].sort((left, right) =>
    left.className.localeCompare(right.className, "fr"),
  );
}

export function filterStudentsByClassIdentity(
  students: Student[],
  identity: Partial<AttendanceClassIdentity> | null | undefined,
  classes: SchoolClass[] = [],
): Student[] {
  if (!identity) return [];
  const classId = asRef(identity.classId);
  const classCode = asRef(identity.classCode);
  if (classId) {
    return students.filter((student) => {
      const resolved = resolveStudentClassIdentity(student, classes);
      return resolved?.classId === classId;
    });
  }
  if (classCode) {
    return students.filter((student) => {
      const resolved = resolveStudentClassIdentity(student, classes);
      return resolved?.classCode === classCode;
    });
  }
  return filterStudentsByClassName(students, asRef(identity.className));
}

export function assertAttendanceClassIdentity(
  identity: Partial<AttendanceClassIdentity> | null | undefined,
): identity is AttendanceClassIdentity {
  return Boolean(asRef(identity?.classId) && asRef(identity?.classCode));
}

export function presenceIntentionId(classId: string, dateLabel: string) {
  return `presence:${asRef(classId)}:${asRef(dateLabel)}`;
}

export type AttendanceAssignmentAuthor = {
  teacherId?: string;
  teacherCode?: string;
  teacherName?: string;
  status?: string;
  schoolCode?: string;
  classId?: string | null;
  classCode?: string;
  className?: string;
};

export type AssignmentClassRef = {
  classId?: string | null;
  classCode?: string;
  className?: string;
};

/**
 * Fail-closed : classId, sinon classCode, jamais className.
 * Deux classes homonymes (même nom, IDs/codes différents) ne partagent pas leurs enseignants.
 */
export function assignmentMatchesClassIdentity(
  assignment: AssignmentClassRef,
  identity: Partial<AttendanceClassIdentity> | null | undefined,
): boolean {
  if (!identity) return false;
  const selectedId = asRef(identity.classId);
  const selectedCode = asRef(identity.classCode);
  const assignmentId = asRef(assignment.classId);
  if (assignmentId) return Boolean(selectedId) && assignmentId === selectedId;
  const assignmentCode = asRef(assignment.classCode);
  if (assignmentCode) return Boolean(selectedCode) && assignmentCode === selectedCode;
  return false;
}

export function assignmentsForClassIdentity<T extends AssignmentClassRef>(
  assignments: T[],
  identity: Partial<AttendanceClassIdentity> | null | undefined,
): T[] {
  if (!identity) return [];
  return assignments.filter((assignment) => assignmentMatchesClassIdentity(assignment, identity));
}

export type AttendanceAuthorCatalogRow = {
  id?: string;
  publicId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  schoolCode?: string;
};

export type AttendanceAuthorOption = {
  teacherId: string;
  label: string;
};

export const ATTENDANCE_AUTHOR_COPY = {
  none: "Affectez un enseignant à cette classe avant d'enregistrer l'appel (admin/direction).",
  needSelection:
    "Plusieurs enseignants sont affectés à cette classe. Choisissez l'auteur de l'appel avant d'enregistrer.",
  outsideClass: "Cet enseignant n'est pas affecté à cette classe.",
  outsideTenant: "Cet enseignant n'appartient pas à cet établissement.",
} as const;

function assignmentTeacherKey(row: AttendanceAssignmentAuthor) {
  return asRef(row.teacherId) || asRef(row.teacherCode);
}

function sameSchoolCode(left?: string, right?: string) {
  const a = asRef(left).toUpperCase();
  const b = asRef(right).toUpperCase();
  return Boolean(a && b && a === b);
}

function teacherCatalogRow(teachers: AttendanceAuthorCatalogRow[] | undefined, teacherId: string) {
  const key = asRef(teacherId);
  if (!key) return null;
  return (
    (teachers ?? []).find(
      (row) => asRef(row.id) === key || asRef(row.publicId) === key,
    ) ?? null
  );
}

function teacherLabel(row: AttendanceAssignmentAuthor, catalog?: AttendanceAuthorCatalogRow | null) {
  const assigned = asRef(row.teacherName);
  if (assigned) return assigned;
  const named = asRef(catalog?.name) || `${asRef(catalog?.firstName)} ${asRef(catalog?.lastName)}`.trim();
  return named || assignmentTeacherKey(row);
}

/** Enseignants avec affectation active sur la classe. Jamais le premier comme défaut. */
export function listActiveClassAuthorOptions(
  assignments: AttendanceAssignmentAuthor[],
  teachers: AttendanceAuthorCatalogRow[] = [],
): AttendanceAuthorOption[] {
  const seen = new Set<string>();
  const options: AttendanceAuthorOption[] = [];
  for (const row of assignments) {
    if (!isCanonicalActiveAssignment(row)) continue;
    const teacherId = assignmentTeacherKey(row);
    if (!teacherId || seen.has(teacherId)) continue;
    seen.add(teacherId);
    options.push({
      teacherId,
      label: teacherLabel(row, teacherCatalogRow(teachers, teacherId)),
    });
  }
  return options;
}

export function uniqueActiveAssignmentTeacherKey(
  assignments: AttendanceAssignmentAuthor[],
): { ok: true; teacherId: string } | { ok: false; reason: "none" | "ambiguous" } {
  const options = listActiveClassAuthorOptions(assignments);
  if (options.length === 1) return { ok: true, teacherId: options[0].teacherId };
  if (options.length === 0) return { ok: false, reason: "none" };
  return { ok: false, reason: "ambiguous" };
}

export type AttendanceAuthorDecision =
  | { status: "teacher_session" }
  | { status: "auto"; teacherId: string }
  | { status: "need_selection"; options: AttendanceAuthorOption[] }
  | { status: "selected"; teacherId: string }
  | { status: "blocked"; reason: "none" | "outside_class" | "outside_tenant"; message: string };

/**
 * Enseignant : le backend utilise principal.sub — ne pas forger teacherId.
 * Admin/direction : 0 → blocage ; 1 → auto ; 2+ → sélection explicite (jamais le premier).
 */
export function resolveAttendanceAuthor(opts: {
  session: { role?: string; user?: { role?: string } } | null;
  assignmentsForClass: AttendanceAssignmentAuthor[];
  selectedTeacherId?: string;
  sessionSchoolCode?: string;
  teachers?: AttendanceAuthorCatalogRow[];
}): AttendanceAuthorDecision {
  if (isTeacherSession(opts.session)) {
    return { status: "teacher_session" };
  }
  const options = listActiveClassAuthorOptions(opts.assignmentsForClass, opts.teachers);
  if (options.length === 0) {
    return { status: "blocked", reason: "none", message: ATTENDANCE_AUTHOR_COPY.none };
  }
  if (options.length === 1) {
    return { status: "auto", teacherId: options[0].teacherId };
  }

  const selected = asRef(opts.selectedTeacherId);
  if (!selected) {
    return { status: "need_selection", options };
  }
  const allowed = new Set(options.map((row) => row.teacherId));
  if (allowed.has(selected)) {
    return { status: "selected", teacherId: selected };
  }
  const catalog = teacherCatalogRow(opts.teachers, selected);
  if (
    catalog &&
    asRef(opts.sessionSchoolCode) &&
    asRef(catalog.schoolCode) &&
    !sameSchoolCode(catalog.schoolCode, opts.sessionSchoolCode)
  ) {
    return { status: "blocked", reason: "outside_tenant", message: ATTENDANCE_AUTHOR_COPY.outsideTenant };
  }
  return { status: "blocked", reason: "outside_class", message: ATTENDANCE_AUTHOR_COPY.outsideClass };
}

export function resolveExplicitAttendanceTeacherKey(opts: {
  session: { role?: string; user?: { role?: string } } | null;
  assignmentsForClass: AttendanceAssignmentAuthor[];
  selectedTeacherId?: string;
  sessionSchoolCode?: string;
  teachers?: AttendanceAuthorCatalogRow[];
}): { teacherId?: string } | { blocked: string } {
  const decision = resolveAttendanceAuthor(opts);
  if (decision.status === "teacher_session") return {};
  if (decision.status === "auto" || decision.status === "selected") return { teacherId: decision.teacherId };
  if (decision.status === "need_selection") return { blocked: ATTENDANCE_AUTHOR_COPY.needSelection };
  return { blocked: decision.message };
}

export function authorTeacherIdFromOutboxPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  const top = asRef(row.teacherId);
  if (top) return top;
  const items = Array.isArray(row.items) ? row.items : [];
  const first = items[0] && typeof items[0] === "object" ? items[0] as Record<string, unknown> : null;
  return asRef(first?.teacherId);
}

export function persistAttendanceAuthorSelection(
  current: Record<string, string>,
  intentionId: string,
  teacherId: string,
): Record<string, string> {
  const key = asRef(intentionId);
  const value = asRef(teacherId);
  if (!key || !value) return current;
  if (current[key] === value) return current;
  return { ...current, [key]: value };
}

export function attachAttendanceAuthorToPayload<T extends Record<string, unknown>>(
  payload: T,
  teacherId?: string,
): T & { teacherId?: string } {
  const key = asRef(teacherId);
  if (!key) return payload;
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) =>
        item && typeof item === "object" ? { ...(item as Record<string, unknown>), teacherId: key } : item,
      )
    : payload.items;
  return { ...payload, teacherId: key, items };
}
