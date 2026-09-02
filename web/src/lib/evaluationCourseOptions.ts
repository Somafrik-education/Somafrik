/**
 * Options du select Cours (Nouvelle évaluation).
 * Enseignant : JWT/session.user.assignments d'abord — jamais le catalogue global.
 */

import type { BackOfficeState, SessionUser } from "../types";
import { normalize } from "./format";
import { isTeacherUserRole } from "./userTeacherSync";

type Row = Record<string, unknown>;

export type CourseOptionsInput = {
  state: Pick<BackOfficeState, "courses" | "assignments" | "classes"> | BackOfficeState;
  user?: SessionUser | null;
  schoolCode: string;
  classId?: string | null;
  classCode?: string | null;
  className?: string | null;
};

function asRef(value: unknown) {
  return String(value ?? "").trim();
}

function isExplicitlyActiveAssignmentStatus(status: unknown) {
  const normalized = asRef(status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized) return false;
  return ["active", "actif", "open", "ouverte"].includes(normalized);
}

function courseNameFromRow(row: Row) {
  return asRef(row.course ?? row.subject ?? row.name);
}

function assignmentClassId(row: Row) {
  return asRef(row.classId ?? row.class_id);
}

function assignmentClassCode(row: Row) {
  return asRef(row.classCode ?? row.class_code);
}

function assignmentClassName(row: Row) {
  return asRef(row.className ?? row.class_name);
}

function teacherIdentityKeys(user: SessionUser | null | undefined) {
  const keys = new Set<string>();
  for (const value of [user?.id, user?.identifier, user?.publicId, user?.teacherCode, user?.contactId]) {
    const key = asRef(value);
    if (key) keys.add(key);
  }
  return keys;
}

function assignmentBelongsToTeacher(row: Row, teacherKeys: Set<string>) {
  if (!teacherKeys.size) return false;
  const teacherId = asRef(row.teacherId ?? row.teacherCode ?? row.teacher_id);
  if (!teacherId) return false;
  return teacherKeys.has(teacherId);
}

function assignmentMatchesSchool(row: Row, schoolCode: string) {
  const rowSchool = asRef(row.schoolCode ?? row.school_code);
  if (!rowSchool || !schoolCode || schoolCode === "*") return true;
  return normalize(rowSchool) === normalize(schoolCode);
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "fr"),
  );
}

function resolveSelectedClassIdentity(input: CourseOptionsInput): {
  classId: string;
  classCode: string;
  className: string;
} {
  let classId = asRef(input.classId);
  let classCode = asRef(input.classCode);
  const className = asRef(input.className);

  if (classId && classCode) {
    return { classId, classCode, className };
  }

  const jwtRows = Array.isArray(input.user?.assignments) ? (input.user.assignments as Row[]) : [];
  const named = jwtRows.filter((row) => {
    if (!className) return false;
    const name = assignmentClassName(row);
    if (!name || normalize(name) !== normalize(className)) return false;
    return Boolean(assignmentClassId(row) || assignmentClassCode(row));
  });
  const jwtIds = [...new Set(named.map((row) => assignmentClassId(row)).filter(Boolean))];
  const jwtCodes = [...new Set(named.map((row) => assignmentClassCode(row)).filter(Boolean))];
  if (!classId && jwtIds.length === 1) classId = jwtIds[0];
  if (!classCode && jwtCodes.length === 1) classCode = jwtCodes[0];

  if (!classId || !classCode) {
    const classes = ((input.state.classes ?? []) as Row[]).filter((row) => {
      if (!className) return false;
      return normalize(asRef(row.name ?? row.className)) === normalize(className);
    });
    if (classes.length === 1) {
      const only = classes[0];
      if (!classId) classId = asRef(only.classId ?? only.class_id ?? only.id);
      if (!classCode) classCode = asRef(only.classCode ?? only.class_code ?? only.publicId);
    }
  }

  return { classId, classCode, className };
}

function teacherAssignmentMatchesClass(
  row: Row,
  selected: { classId: string; classCode: string; className: string },
) {
  const rowId = assignmentClassId(row);
  const rowCode = assignmentClassCode(row);
  if (!rowId && !rowCode) return false;
  if (selected.classId && rowId) return rowId === selected.classId;
  if (selected.classCode && rowCode) return rowCode === selected.classCode;
  return false;
}

function collectTeacherAssignments(input: CourseOptionsInput): Row[] {
  const user = input.user ?? null;
  const collected: Row[] = [];
  const seen = new Set<string>();

  const push = (row: Row) => {
    if (!isExplicitlyActiveAssignmentStatus(row.status ?? row.assignmentStatus ?? row.assignment_status)) {
      return;
    }
    if (!assignmentMatchesSchool(row, input.schoolCode)) return;
    const course = courseNameFromRow(row);
    if (!course) return;
    const key = [
      assignmentClassId(row) || assignmentClassCode(row),
      normalize(course),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(row);
  };

  for (const row of Array.isArray(user?.assignments) ? (user.assignments as Row[]) : []) {
    push(row);
  }

  const teacherKeys = teacherIdentityKeys(user);
  for (const row of (input.state.assignments ?? []) as Row[]) {
    if (!assignmentBelongsToTeacher(row, teacherKeys)) continue;
    push(row);
  }

  return collected;
}

function catalogMatchesClass(
  row: Row,
  schoolCode: string,
  selected: { classId: string; classCode: string; className: string },
) {
  if (!assignmentMatchesSchool(row, schoolCode)) return false;
  const rowId = assignmentClassId(row);
  const rowCode = assignmentClassCode(row);
  const rowName = assignmentClassName(row) || asRef(row.name);
  if (selected.classId && rowId) return rowId === selected.classId;
  if (selected.classCode && rowCode) return rowCode === selected.classCode;
  if (selected.className && rowName) return normalize(rowName) === normalize(selected.className);
  return false;
}

function catalogCourseOptions(input: CourseOptionsInput, selected: { classId: string; classCode: string; className: string }) {
  const fromCourses = ((input.state.courses ?? []) as Row[])
    .filter((row) => catalogMatchesClass(row, input.schoolCode, selected))
    .map((row) => courseNameFromRow(row));
  if (fromCourses.some(Boolean)) return uniqueSorted(fromCourses);

  return uniqueSorted(
    ((input.state.assignments ?? []) as Row[])
      .filter((row) => catalogMatchesClass(row, input.schoolCode, selected))
      .map((row) => courseNameFromRow(row)),
  );
}

/**
 * Cours proposés pour une classe dans la création d'évaluation.
 *
 * 1. Enseignant : currentUser.assignments (statut actif + classId/classCode)
 * 2. Enseignant : state.assignments complémentaire, même identité
 * 3. Admin / Préfet : catalogue state.courses, sinon state.assignments de la classe
 *
 * Pas de fallback catalogue global pour un enseignant sans affectation.
 */
export function courseOptionsForClass(input: CourseOptionsInput): string[] {
  const selected = resolveSelectedClassIdentity(input);
  if (isTeacherUserRole(input.user?.role)) {
    return uniqueSorted(
      collectTeacherAssignments(input)
        .filter((row) => teacherAssignmentMatchesClass(row, selected))
        .map((row) => courseNameFromRow(row)),
    );
  }
  return catalogCourseOptions(input, selected);
}

/** Compatibilité P1 : le nom interne subject* reste, le métier est Cours. */
export function subjectOptionsForClass(
  state: BackOfficeState,
  schoolCode: string,
  className: string,
  user?: SessionUser | null,
): string[] {
  return courseOptionsForClass({ state, user, schoolCode, className });
}
