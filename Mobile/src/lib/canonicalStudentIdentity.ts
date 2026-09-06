/**
 * Identité métier élève côté session Mobile.
 * students.id (linkedStudent.studentId) gagne toujours sur users.id.
 */
export function resolveSessionStudentId(user: {
  id?: string;
  linkedStudent?: { studentId?: string } | null;
  children?: Array<{ id?: string }>;
} | null | undefined): string | null {
  const fromLink = String(user?.linkedStudent?.studentId ?? "").trim();
  if (fromLink) return fromLink;
  const fromChild = String(user?.children?.[0]?.id ?? "").trim();
  if (fromChild) return fromChild;
  return null;
}
