/**
 * Identité de classe pour l'appel Mobile : classId + classCode, jamais className comme clé.
 */
import type { SchoolClass, Student } from "../data/catalog";
import { classNameMatches, filterStudentsByClassName } from "./establishment";

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

export function listScopedAttendanceClasses(
  students: Student[],
  classes: SchoolClass[] = [],
): AttendanceClassIdentity[] {
  const byKey = new Map<string, AttendanceClassIdentity>();
  for (const student of students) {
    const identity = resolveStudentClassIdentity(student, classes);
    if (identity) {
      const key = classIdentityKey(identity);
      if (!byKey.has(key)) byKey.set(key, identity);
      continue;
    }
    const className = asRef(student.className);
    if (!className) continue;
    const fallbackKey = `name:${className.toLowerCase()}`;
    if (!byKey.has(fallbackKey)) {
      byKey.set(fallbackKey, { classId: "", classCode: "", className });
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
