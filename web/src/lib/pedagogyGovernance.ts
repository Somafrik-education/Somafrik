import { normalize } from "./format";

type Row = Record<string, unknown>;

function sameTeacherReference(left: Row, right: Row): boolean {
  const leftId = normalize(String(left.teacherId ?? ""));
  const rightId = normalize(String(right.teacherId ?? ""));
  if (leftId && rightId && leftId === rightId) return true;

  const leftName = normalize(String(left.teacherName ?? ""));
  const rightName = normalize(String(right.teacherName ?? ""));
  return Boolean(leftName && rightName && leftName === rightName);
}

/** Un cours (matière + classe) = un seul enseignant. */
export function validateCourseTeacherRule(
  item: Row,
  courses: Row[],
  assignments: Row[] = [],
  editingId?: string,
): string | null {
  const className = String(item.className ?? "").trim();
  const subject = String(item.name ?? item.subject ?? "").trim();
  const teacherId = String(item.teacherId ?? "").trim();
  const teacherName = String(item.teacherName ?? "").trim();

  if (!className || !subject) {
    return "Classe et cours sont obligatoires.";
  }

  if (!teacherId && !teacherName) {
    return "Sélectionnez l'enseignant responsable de ce cours pour cette classe.";
  }

  const duplicateCourse = courses.find((course) => {
    if (editingId && String(course.id) === String(editingId)) return false;
    return (
      normalize(String(course.name ?? "")) === normalize(subject) &&
      normalize(String(course.className ?? "")) === normalize(className)
    );
  });

  if (duplicateCourse && !sameTeacherReference(duplicateCourse, item)) {
    const assigned =
      String(duplicateCourse.teacherName ?? duplicateCourse.teacherId ?? "un autre enseignant");
    return `Le cours « ${subject} » est déjà affecté à ${assigned} pour la classe ${className}.`;
  }

  const duplicateAssignment = assignments.find((assignment) => {
    return (
      normalize(String(assignment.className ?? "")) === normalize(className) &&
      normalize(String(assignment.subject ?? assignment.course ?? "")) === normalize(subject)
    );
  });

  if (duplicateAssignment && !sameTeacherReference(duplicateAssignment, item)) {
    const assigned =
      String(duplicateAssignment.teacherName ?? duplicateAssignment.teacherId ?? "un autre enseignant");
    return `Le cours « ${subject} » est déjà affecté à ${assigned} pour la classe ${className}.`;
  }

  return null;
}

/** Admin School : consultation, création et mise à jour des fiches enseignants. */
export function canSchoolAdminMutateTeachers(action: string): boolean {
  return action === "READ" || action === "CREATE" || action === "UPDATE";
}
