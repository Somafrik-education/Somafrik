import { normalize } from "./format";
import { isTeacherUserRole } from "./userTeacherSync";
import { sessionRoleToPlatformRole } from "./orgHierarchy";
import type { Student, Teacher, TeacherAssignment, SchoolClass } from "../data/catalog";

type Row = Record<string, unknown>;

export interface TeacherScopeState {
  teachers?: Teacher[];
  assignments?: TeacherAssignment[];
  classes?: SchoolClass[];
}

export function isTeacherSession(session: { role?: string; user?: { role?: string } } | null): boolean {
  if (!session) return false;
  if (session.role === "teacher") return true;
  return isTeacherUserRole(session.user?.role) || isTeacherUserRole(sessionRoleToPlatformRole(session.role));
}

export function classNameMatches(left?: string, right?: string): boolean {
  return normalize(left) === normalize(right);
}

/** Retrouve la fiche enseignant liée à la session (userId puis identifiant). */
export function resolveTeacherRecordForSession(
  session: { user?: Row } | null,
  teachers: Teacher[] = [],
): Teacher | null {
  const user = session?.user;
  if (!user) return null;
  const userId = String(user.id ?? "").trim();
  const identifier = normalize(String(user.identifier ?? ""));
  return (
    teachers.find((teacher) => {
      const row = teacher as Row;
      if (userId && String(row.userId ?? "") === userId) return true;
      if (identifier && normalize(String(row.identifier ?? "")) === identifier) return true;
      return false;
    }) ?? null
  );
}

/**
 * Noms de classes affectées à l'enseignant (clés normalisées).
 * Retourne `null` si l'utilisateur n'est pas enseignant.
 */
export function teacherScopedClassNames(
  session: { role?: string; user?: Row } | null,
  state: TeacherScopeState = {},
): Set<string> | null {
  if (!isTeacherSession(session)) return null;

  const names = new Set<string>();
  const addName = (value: unknown) => {
    const name = normalize(value);
    if (name) names.add(name);
  };

  const user = session?.user ?? {};
  if (Array.isArray(user.assignedClasses)) {
    (user.assignedClasses as string[]).forEach(addName);
  }
  if (Array.isArray(user.assignments)) {
    (user.assignments as Row[]).forEach((assignment) => addName(assignment.className));
  }

  const teacher = resolveTeacherRecordForSession(session, state.teachers ?? []);
  const teacherId = String(teacher?.id ?? user.id ?? "").trim();
  const teacherPublicId = String(teacher?.publicId ?? user.publicId ?? "").trim();
  const teacherNameKeys = new Set<string>();
  const addTeacherName = (value: unknown) => {
    const key = normalize(value);
    if (key) teacherNameKeys.add(key);
  };
  [teacher?.name, teacher?.firstName, teacher?.lastName, user.name, user.firstName, user.lastName]
    .forEach(addTeacherName);
  const first = normalize(teacher?.firstName ?? user.firstName);
  const last = normalize(teacher?.name ?? teacher?.lastName ?? user.lastName);
  if (first && last) {
    teacherNameKeys.add(`${first} ${last}`.trim());
    teacherNameKeys.add(`${last} ${first}`.trim());
  }

  if (teacher) {
    if (Array.isArray(teacher.assignedClasses)) {
      teacher.assignedClasses.forEach(addName);
    }
    if (Array.isArray(teacher.assignments)) {
      teacher.assignments.forEach((assignment) => addName(assignment.className));
    }
  }

  for (const assignment of state.assignments ?? []) {
    const ref = String(assignment.teacherId ?? "").trim();
    const matchesId =
      ref &&
      (ref === teacherId || ref === teacherPublicId || (user.id && ref === String(user.id)));
    const matchesName =
      teacherNameKeys.size > 0 && teacherNameKeys.has(normalize(assignment.teacherName));
    if (matchesId || matchesName) addName(assignment.className);
  }

  for (const schoolClass of state.classes ?? []) {
    const responsible = String(schoolClass.teacherId ?? "").trim();
    if (!responsible || (responsible !== teacherId && responsible !== teacherPublicId)) continue;
    addName(schoolClass.name);
  }

  return names;
}

/** Libellés affichables des classes enseignant (dérivés des élèves visibles). */
export function teacherScopedClassLabels(
  session: { role?: string; user?: Row } | null,
  students: Student[],
  state: TeacherScopeState = {},
): string[] {
  const scopedKeys = teacherScopedClassNames(session, state);
  if (!scopedKeys) {
    return [...new Set(students.map((student) => String(student.className ?? "").trim()).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right, "fr"),
    );
  }

  const labels = new Map<string, string>();
  students.forEach((student) => {
    const label = String(student.className ?? "").trim();
    const key = normalize(label);
    if (key && scopedKeys.has(key)) {
      labels.set(key, label);
    }
  });

  if (!labels.size) {
    scopedKeys.forEach((key) => labels.set(key, key));
  }

  return [...labels.values()].sort((left, right) => left.localeCompare(right, "fr"));
}

export function scopedStudentsForSession(
  session: { role?: string; user?: Row; school?: { code?: string } } | null,
  students: Student[],
  state: TeacherScopeState = {},
): Student[] {
  const schoolCode = String(session?.user?.schoolCode ?? session?.school?.code ?? "").trim();
  let rows = students;
  if (schoolCode && schoolCode !== "*") {
    rows = rows.filter((student) => normalize(student.schoolCode) === normalize(schoolCode));
  }

  const teacherClasses = teacherScopedClassNames(session, state);
  if (teacherClasses && teacherClasses.size > 0) {
    rows = rows.filter((student) => teacherClasses.has(normalize(student.className)));
  }
  return rows;
}

/** Affectations enseignant : session + table globale (aligné web). */
export function resolveTeacherAssignmentsForSession(
  session: { user?: Row } | null,
  assignments: TeacherAssignment[] = [],
): TeacherAssignment[] {
  const user = session?.user ?? {};
  const fromUser = Array.isArray(user.assignments) ? (user.assignments as TeacherAssignment[]) : [];
  const teacherId = String(user.id ?? "").trim();
  const teacherPublicId = String(user.publicId ?? "").trim();
  const teacherNameKeys = new Set<string>();
  const addTeacherName = (value: unknown) => {
    const key = normalize(value);
    if (key) teacherNameKeys.add(key);
  };
  [user.name, user.firstName, user.lastName].forEach(addTeacherName);
  const first = normalize(user.firstName);
  const last = normalize(user.lastName ?? user.name);
  if (first && last) {
    teacherNameKeys.add(`${first} ${last}`.trim());
    teacherNameKeys.add(`${last} ${first}`.trim());
  }

  const fromGlobal = assignments.filter((assignment) => {
    const ref = String((assignment as Row).teacherId ?? "").trim();
    if (ref && (ref === teacherId || ref === teacherPublicId)) return true;
    return teacherNameKeys.size > 0 && teacherNameKeys.has(normalize((assignment as Row).teacherName));
  });

  const seen = new Set<string>();
  return [...fromUser, ...fromGlobal].filter((assignment) => {
    const key = `${normalize(assignment.className)}|${normalize(assignment.course)}`;
    if (!assignment.className || !assignment.course || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Affectations d'une fiche enseignant donnée (pas la session) : fusionne les
 * affectations embarquées sur la fiche et la table globale des affectations
 * (module Affectations), en faisant correspondre par id, publicId, userId ou nom.
 * Aligne l'affichage mobile sur le web (où les matières viennent des Affectations).
 */
export function resolveTeacherAssignmentsForRecord(
  teacher: Teacher | undefined,
  assignments: TeacherAssignment[] = [],
): TeacherAssignment[] {
  const row = (teacher ?? {}) as Row;
  const fromRecord = Array.isArray(row.assignments) ? (row.assignments as TeacherAssignment[]) : [];

  const refKeys = new Set<string>();
  [row.id, row.publicId, row.userId, row.identifier].forEach((value) => {
    const key = String(value ?? "").trim();
    if (key) refKeys.add(key);
  });

  const nameKeys = new Set<string>();
  const addName = (value: unknown) => {
    const key = normalize(value);
    if (key) nameKeys.add(key);
  };
  [row.name, row.firstName, row.lastName].forEach(addName);
  const first = normalize(row.firstName);
  const last = normalize(row.lastName ?? row.name);
  if (first && last) {
    nameKeys.add(`${first} ${last}`.trim());
    nameKeys.add(`${last} ${first}`.trim());
  }

  const fromGlobal = assignments.filter((assignment) => {
    const ref = String((assignment as Row).teacherId ?? "").trim();
    if (ref && refKeys.has(ref)) return true;
    return nameKeys.size > 0 && nameKeys.has(normalize((assignment as Row).teacherName));
  });

  const seen = new Set<string>();
  return [...fromRecord, ...fromGlobal].filter((assignment) => {
    const key = `${normalize(assignment.className)}|${normalize(assignment.course)}`;
    if (!assignment.className || !assignment.course || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Matières distinctes d'un enseignant (fiche + Affectations globales). */
export function resolveTeacherCoursesForRecord(
  teacher: Teacher | undefined,
  assignments: TeacherAssignment[] = [],
): string[] {
  return [
    ...new Set(
      resolveTeacherAssignmentsForRecord(teacher, assignments)
        .map((assignment) => String(assignment.course ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

/** Classes distinctes d'un enseignant (fiche + Affectations globales). */
export function resolveTeacherClassesForRecord(
  teacher: Teacher | undefined,
  assignments: TeacherAssignment[] = [],
): string[] {
  return [
    ...new Set(
      resolveTeacherAssignmentsForRecord(teacher, assignments)
        .map((assignment) => String(assignment.className ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

export function filterStudentsByClassName(students: Student[], className: string): Student[] {
  return students.filter((student) => classNameMatches(student.className, className));
}

/** Classes visibles selon établissement et périmètre enseignant (aligné web `scopedClasses`). */
export function scopedClassesForSession(
  session: { role?: string; user?: Row; school?: { code?: string } } | null,
  classes: SchoolClass[],
  students: Student[],
  state: TeacherScopeState = {},
): SchoolClass[] {
  const schoolCode = String(session?.user?.schoolCode ?? session?.school?.code ?? "").trim();
  const scopedStudentsList = scopedStudentsForSession(session, students, state);
  const classNames = new Set(
    scopedStudentsList.map((student) => String(student.className ?? "").trim()).filter(Boolean),
  );

  const base =
    !schoolCode || schoolCode === "*"
      ? classes
      : classes.filter((item) => {
          const row = item as Row;
          return normalize(row.schoolCode) === normalize(schoolCode) || classNames.has(String(item.name ?? "").trim());
        });

  const rows = [...base];
  classNames.forEach((className) => {
    if (!rows.some((item) => classNameMatches(item.name, className))) {
      rows.push({
        id: `CLASS-${className}`,
        publicId: `CLASS-${className}`,
        name: className,
        level: "",
        track: "",
        teacherId: "",
      });
    }
  });

  const teacherClassNames = teacherScopedClassNames(session, state);
  if (teacherClassNames && teacherClassNames.size > 0) {
    return rows.filter((item) => teacherClassNames.has(normalize(item.name)));
  }
  return rows;
}

/** Identifiant API stable (aligné enregistrement présences / notes backend). */
export function resolveStudentApiId(student: Pick<Student, "id" | "matricule" | "publicId">): string {
  return String(student.matricule ?? student.publicId ?? student.id ?? "").trim();
}

/** Période par défaut : privilégie une période qui contient déjà des notes. */
export function resolveGradesPeriod(
  notes: { period?: string; schoolCode?: string }[],
  schoolCode: string,
  fallbackPeriod: string,
): string {
  const normalizedSchool = normalize(schoolCode);
  const scopedNotes = notes.filter((note) => {
    if (!normalizedSchool) return true;
    const noteSchool = normalize(String(note.schoolCode ?? ""));
    return !noteSchool || noteSchool === normalizedSchool;
  });

  const periodCounts = new Map<string, number>();
  for (const note of scopedNotes) {
    const periodName = String(note.period ?? "").trim();
    if (!periodName) continue;
    periodCounts.set(periodName, (periodCounts.get(periodName) ?? 0) + 1);
  }

  if (periodCounts.size) {
    return [...periodCounts.entries()].sort((left, right) => right[1] - left[1])[0][0];
  }
  return fallbackPeriod;
}
