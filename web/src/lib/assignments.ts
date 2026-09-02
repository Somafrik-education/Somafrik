import type { BackOfficeState, SessionUser } from "../types";
import { getSchoolAcademicLists, getSubjectsForClass } from "./academicConfig";
import {
  scopedClasses,
  scopedCourses,
  scopedStudents,
  scopedTeachers,
} from "./establishment";
import { normalize } from "./format";
import { findTeacherByName, getTeacherDisplayName, teacherMatchesReference } from "./pedagogySync";

type Row = Record<string, unknown>;

function resolveAssignmentSchoolCode(
  user: SessionUser | null,
  state: BackOfficeState,
  schoolCode?: string,
): string | undefined {
  if (schoolCode && schoolCode !== "*") return schoolCode;
  if (user?.schoolCode && user.schoolCode !== "*") return user.schoolCode;
  return state.schools[0]?.code;
}

/**
 * Code établissement à attacher à une affectation. On privilégie l'établissement
 * de la classe choisie afin que la clé de déduplication backend
 * (schoolCode|classe|matière) coïncide avec la version dérivée des enseignants et
 * évite les doublons après synchronisation.
 */
function resolveAssignmentSchoolCodeForClass(
  className: string,
  user: SessionUser | null,
  state: BackOfficeState | undefined,
  schoolCode?: string,
): string | undefined {
  if (state && className) {
    const classSchool = state.classes.find(
      (schoolClass) =>
        normalize(String((schoolClass as Row).name ?? "")) === normalize(className) &&
        String((schoolClass as Row).schoolCode ?? "").trim(),
    );
    const code = String((classSchool as Row | undefined)?.schoolCode ?? "").trim();
    if (code && code !== "*") return code;
  }
  if (!state) {
    return schoolCode && schoolCode !== "*" ? schoolCode : undefined;
  }
  return resolveAssignmentSchoolCode(user, state, schoolCode);
}

function isKnownClassName(
  className: string,
  classes: Row[],
  state: BackOfficeState,
  schoolCode?: string,
): boolean {
  if (classes.some((schoolClass) => normalize(String(schoolClass.name ?? "")) === normalize(className))) {
    return true;
  }
  const { classNames } = getSchoolAcademicLists(state, schoolCode);
  return classNames.some((name) => normalize(name) === normalize(className));
}

function isKnownSubjectForClass(
  subject: string,
  className: string,
  courses: Row[],
  state: BackOfficeState,
  schoolCode?: string,
): boolean {
  if (
    courses.some(
      (course) =>
        normalize(String(course.name ?? "")) === normalize(subject) &&
        normalize(String(course.className ?? "")) === normalize(className),
    )
  ) {
    return true;
  }
  return getSubjectsForClass(state, schoolCode, className).some(
    (name) => normalize(name) === normalize(subject),
  );
}

export function normalizeAssignmentForm(row: Row, teachers: Row[]): Row {
  let teacherId = String(row.teacherId ?? "");
  if (!teacherId && row.teacherName) {
    const teacher = findTeacherByName(teachers, String(row.teacherName));
    teacherId = String(teacher?.id ?? "");
  }
  const subject = String(row.subject ?? row.course ?? "").trim();
  return {
    ...row,
    teacherId,
    subject,
    course: subject,
  };
}

export function prepareAssignmentForSave(
  form: Row,
  teachers: Row[],
  schoolCode?: string,
  state?: BackOfficeState,
  user: SessionUser | null = null,
): Row {
  const teacherId = String(form.teacherId ?? "");
  const teacher = teachers.find((item) => String(item.id) === teacherId);
  const teacherName = teacher ? getTeacherDisplayName(teacher) : String(form.teacherName ?? "").trim();
  const subject = String(form.subject ?? form.course ?? "").trim();
  const className = String(form.className ?? "").trim();
  const existingSchoolCode = String(form.schoolCode ?? "").trim();
  const resolvedSchoolCode =
    resolveAssignmentSchoolCodeForClass(className, user, state, schoolCode) ??
    (existingSchoolCode && existingSchoolCode !== "*" ? existingSchoolCode : undefined);
  return {
    ...form,
    teacherId,
    teacherName,
    subject,
    course: subject,
    className,
    ...(resolvedSchoolCode && resolvedSchoolCode !== "*" ? { schoolCode: resolvedSchoolCode } : {}),
  };
}

export function formatTeacherAssignmentsSummary(assignments: Row[]): string {
  if (!assignments.length) return "—";
  return assignments
    .map((assignment) => {
      const className = String(assignment.className ?? "").trim();
      const subject = String(assignment.subject ?? assignment.course ?? "").trim();
      return [className, subject].filter(Boolean).join(" · ");
    })
    .filter(Boolean)
    .join(", ");
}

export function listTeacherAssignments(teacher: Row, assignments: Row[]): Row[] {
  const teacherName = getTeacherDisplayName(teacher);
  return assignments.filter((assignment) => {
    const assignmentTeacherId = String(assignment.teacherId ?? "").trim();
    if (assignmentTeacherId && teacherMatchesReference(teacher, assignmentTeacherId)) return true;
    const assignmentTeacherName = String(assignment.teacherName ?? "").trim();
    return Boolean(
      assignmentTeacherName &&
        teacherName &&
        normalize(assignmentTeacherName) === normalize(teacherName),
    );
  });
}

export function validateAssignmentConflict(
  item: Row,
  assignments: Row[],
  courses: Row[],
  classes: Row[],
  teachers: Row[],
  editingId?: string,
  state?: BackOfficeState,
  schoolCode?: string,
): string | null {
  const teacherId = String(item.teacherId ?? "");
  const className = String(item.className ?? "").trim();
  const subject = String(item.subject ?? item.course ?? "").trim();
  const resolvedSchoolCode = state ? resolveAssignmentSchoolCode(null, state, schoolCode) : schoolCode;

  if (!teacherId || !className || !subject) {
    return "Veuillez sélectionner un enseignant, une classe et un cours.";
  }

  if (!teachers.some((teacher) => String(teacher.id) === teacherId)) {
    return "Enseignant introuvable dans votre établissement.";
  }

  if (state && !isKnownClassName(className, classes, state, resolvedSchoolCode)) {
    return `La classe « ${className} » n'est pas reconnue. Créez-la dans Classes ou Configuration.`;
  }

  if (!state && !classes.some((schoolClass) => String(schoolClass.name) === className)) {
    return "Classe introuvable dans votre établissement.";
  }

  if (state && !isKnownSubjectForClass(subject, className, courses, state, resolvedSchoolCode)) {
    return `Le cours « ${subject} » n'est pas configuré pour la classe ${className}. Ajoutez-le dans Configuration → Cours.`;
  }

  if (
    !state &&
    !courses.some(
      (course) =>
        normalize(course.name) === normalize(subject) &&
        normalize(String(course.className ?? "")) === normalize(className),
    )
  ) {
    return `Le cours « ${subject} » n'existe pas pour la classe ${className}.`;
  }

  const duplicate = assignments.find((assignment) => {
    if (editingId && String(assignment.id) === editingId) return false;
    return (
      normalize(String(assignment.className ?? "")) === normalize(className) &&
      normalize(String(assignment.subject ?? assignment.course ?? "")) === normalize(subject)
    );
  });

  if (!duplicate) return null;

  const sameTeacher =
    normalize(String(duplicate.teacherId ?? "")) === normalize(teacherId) ||
    normalize(String(duplicate.teacherName ?? "")) === normalize(String(item.teacherName ?? ""));

  if (sameTeacher) {
    return `Cet enseignant est déjà affecté au cours ${subject} pour la classe ${className}.`;
  }

  return `Le cours ${subject} est déjà affecté à un autre enseignant pour la classe ${className}.`;
}

export interface AssignmentSelectOptions {
  teachers: { value: string; label: string }[];
  classes: { value: string; label: string }[];
  subjects: { value: string; label: string }[];
}

export function getAssignmentSelectOptions(
  user: SessionUser | null,
  state: BackOfficeState,
  className?: string,
  schoolCode?: string,
): AssignmentSelectOptions {
  const resolvedSchoolCode = resolveAssignmentSchoolCode(user, state, schoolCode);
  const teachers = scopedTeachers(user, state);
  const classes = scopedClasses(user, state);
  const courses = scopedCourses(user, state);
  const selectedClass = normalize(className);
  const { classNames: configuredClasses } = getSchoolAcademicLists(state, resolvedSchoolCode);

  const subjectNames = new Set<string>();
  const subjects: { value: string; label: string }[] = [];

  if (className?.trim() && resolvedSchoolCode) {
    getSubjectsForClass(state, resolvedSchoolCode, className.trim()).forEach((name) => {
      if (!name || subjectNames.has(name)) return;
      subjectNames.add(name);
      subjects.push({ value: name, label: name });
    });
  }

  courses
    .filter((course) => !selectedClass || normalize(String(course.className ?? "")) === selectedClass)
    .forEach((course) => {
      const name = String(course.name ?? "").trim();
      if (!name || subjectNames.has(name)) return;
      subjectNames.add(name);
      subjects.push({ value: name, label: name });
    });

  const classOptions = new Set<string>();
  classes.forEach((schoolClass) => {
    const name = String(schoolClass.name ?? "").trim();
    if (name) classOptions.add(name);
  });
  configuredClasses.forEach((name) => {
    if (name.trim()) classOptions.add(name.trim());
  });

  return {
    teachers: teachers.map((teacher) => ({
      value: String(teacher.id ?? ""),
      label: getTeacherDisplayName(teacher),
    })),
    classes: [...classOptions]
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((name) => ({ value: name, label: name })),
    subjects: subjects.sort((a, b) => a.label.localeCompare(b.label, "fr")),
  };
}

/** Options élève ↔ classe (affectation pédagogique complémentaire). */
export function getAssignmentStudentOptions(user: SessionUser | null, state: BackOfficeState) {
  return scopedStudents(user, state).map((student) => ({
    value: String(student.id ?? ""),
    label: [student.name, student.className].filter(Boolean).join(" · "),
  }));
}
