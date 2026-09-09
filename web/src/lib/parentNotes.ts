import type { BackOfficeState, Evaluation, SessionUser, StudentGrade } from "../types";
import { formatStudentName } from "./gradeBook";
import { scopedStudents } from "./establishment";
import { normalize } from "./format";

type StudentRow = Record<string, unknown>;

export const PARENT_NOTES_TABS = [
  { key: "notes", label: "Notes" },
  { key: "evaluations", label: "Évaluations" },
  { key: "matiere", label: "Par matière" },
] as const;

export type ParentNotesTabKey = (typeof PARENT_NOTES_TABS)[number]["key"];

export const ALL_COURSES_FILTER = "";

function asRef(value: unknown) {
  return String(value ?? "").trim();
}

function studentIdentityKeys(row: StudentRow | null | undefined) {
  if (!row) return [];
  return [row.id, row.studentId, row.publicId, row.matricule, row.studentCode]
    .map(asRef)
    .filter(Boolean);
}

export function isParentNotesRole(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  const keys = Array.isArray(user.roleKeys) ? user.roleKeys : [];
  if (keys.some((key) => asRef(key).toUpperCase() === "PARENT")) return true;
  const role = normalize(String(user.role ?? ""));
  return role === "parent" || role.includes("parent");
}

export function parentLinkedIdSet(user: SessionUser | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!user) return ids;
  const children = Array.isArray(user.children) ? user.children : [];
  for (const child of children) {
    for (const key of studentIdentityKeys(child as StudentRow)) ids.add(key);
  }
  return ids;
}

export function parentLinkedStudents(
  user: SessionUser | null,
  state: Pick<BackOfficeState, "students">,
): StudentRow[] {
  if (!user || !isParentNotesRole(user)) return [];
  const linkedIds = parentLinkedIdSet(user);
  if (!linkedIds.size) return [];

  const fromState = scopedStudents(user, state as BackOfficeState).filter((row) =>
    studentIdentityKeys(row).some((key) => linkedIds.has(key)),
  );
  const seen = new Set<string>();
  const deduped = (fromState.length ? fromState : ((user.children ?? []) as StudentRow[])).filter((row) => {
    const id = asRef(row.id) || asRef(row.matricule);
    if (!id || seen.has(id)) return false;
    if (!studentIdentityKeys(row).some((key) => linkedIds.has(key))) return false;
    seen.add(id);
    return true;
  });
  return deduped;
}

export function isParentLinkedStudentId(
  user: SessionUser | null,
  studentId: string,
  state: Pick<BackOfficeState, "students">,
): boolean {
  const requested = asRef(studentId);
  if (!requested) return false;
  const children = parentLinkedStudents(user, state);
  if (parentLinkedIdSet(user).has(requested)) return true;
  return children.some((row) => studentIdentityKeys(row).includes(requested));
}

export function formatParentClassLabel(
  student: StudentRow | null | undefined,
  schoolPublicCode = "",
): string {
  const className = asRef(student?.className);
  const code = asRef(schoolPublicCode);
  if (className && code) return `${className} ${code}`;
  return className || code || "—";
}

export function parentCourseOptions(grades: StudentGrade[], evaluations: Evaluation[] = []): { value: string; label: string }[] {
  const subjects = [
    ...grades.map((row) => asRef(row.subject)),
    ...evaluations.map((row) => asRef(row.subject ?? row.course)),
  ].filter(Boolean);
  const unique = [...new Set(subjects)].sort((left, right) => left.localeCompare(right, "fr"));
  return [{ value: ALL_COURSES_FILTER, label: "Tous les cours" }, ...unique.map((subject) => ({ value: subject, label: subject }))];
}

export function filterParentGrades(
  grades: StudentGrade[],
  studentId: string,
  period: string,
  course: string,
): StudentGrade[] {
  const childId = asRef(studentId);
  if (!childId) return [];
  return grades.filter((grade) => {
    if (asRef(grade.studentId) !== childId) return false;
    if (period && asRef(grade.period) !== period) return false;
    if (course && asRef(grade.subject) !== course) return false;
    return true;
  });
}

export function parentStudentLabel(student: StudentRow | null | undefined) {
  if (!student) return "";
  return formatStudentName(student);
}
