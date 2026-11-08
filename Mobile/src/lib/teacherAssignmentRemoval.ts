import type { TeacherAssignment } from "../services/api";

/**
 * The school-scoped /assignments API serializes teacherId as teacher_code.
 * Never infer a destructive target from a display name or from embedded
 * teacher.assignments rows, which may not contain canonical assignment IDs.
 */
export function removableAssignmentsForTeacher(
  teacherCode: string | undefined,
  assignments: TeacherAssignment[],
): TeacherAssignment[] {
  const code = String(teacherCode ?? "").trim();
  if (!code) return [];
  return assignments.filter(
    (assignment) =>
      Boolean(String(assignment.id ?? "").trim()) &&
      String(assignment.teacherId ?? "").trim() === code &&
      String(assignment.status ?? "active").toLowerCase() === "active",
  );
}
