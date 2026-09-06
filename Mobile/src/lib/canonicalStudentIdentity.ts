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

/**
 * Périmètre élève pour les écrans métier (paiements, etc.).
 * - student : uniquement selectedStudentId (students.id). Vide = fail-closed, jamais school-wide.
 * - parent_student : uniquement les children. Vide = fail-closed.
 * - autres rôles (admin/staff) : unscoped, données de l'établissement.
 */
export type MobileStudentScope = {
  role: string | null;
  studentIds: string[];
  unscoped: boolean;
};

export function resolveMobileStudentScope(input: {
  role?: string | null;
  selectedStudentId?: string | null;
  children?: Array<{ id?: string | null }> | null;
}): MobileStudentScope {
  const role = input.role ?? null;
  if (role === "student") {
    const id = String(input.selectedStudentId ?? "").trim();
    return { role, studentIds: id ? [id] : [], unscoped: false };
  }
  if (role === "parent_student") {
    const studentIds = (input.children ?? [])
      .map((child) => String(child.id ?? "").trim())
      .filter(Boolean);
    return { role, studentIds, unscoped: false };
  }
  return { role, studentIds: [], unscoped: true };
}

export function filterRowsByStudentScope<T extends { studentId?: string | null }>(
  rows: T[],
  scope: MobileStudentScope,
): T[] {
  if (scope.unscoped) return rows;
  if (!scope.studentIds.length) return [];
  const allowed = new Set(scope.studentIds);
  return rows.filter((row) => Boolean(row.studentId) && allowed.has(String(row.studentId)));
}
