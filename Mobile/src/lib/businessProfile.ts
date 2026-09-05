export type BusinessProfileUser = {
  accountKind?: string;
  linkedStudent?: { studentId?: string; studentCode?: string } | null;
  role?: string;
  activeRoles?: string[];
  secondaryRoles?: string[];
  roleKeys?: string[];
};

function tokensOf(row: BusinessProfileUser): string[] {
  return [
    row.accountKind,
    row.role,
    ...(row.activeRoles ?? []),
    ...(row.secondaryRoles ?? []),
    ...(row.roleKeys ?? []),
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
}

export function isStudentLinkedAccount(row: BusinessProfileUser): boolean {
  if (row.accountKind === "student_login" || row.accountKind === "conflict") return true;
  if (row.linkedStudent?.studentId || row.linkedStudent?.studentCode) return true;
  return tokensOf(row).some(
    (value) =>
      value === "student" ||
      value === "élève / étudiant" ||
      value.includes("élève") ||
      value.includes("eleve"),
  );
}

export function isTeacherLinkedAccount(row: BusinessProfileUser): boolean {
  if (row.accountKind === "teacher" || row.accountKind === "conflict") return true;
  return tokensOf(row).some((value) => value === "enseignant" || value === "teacher");
}

export function accountKindLabel(row: BusinessProfileUser): string | null {
  if (row.accountKind === "conflict") return "Conflit élève + enseignant";
  if (isStudentLinkedAccount(row)) return "Compte lié à un élève";
  if (row.accountKind === "teacher") return "Profil enseignant";
  return null;
}

export const STUDENT_TEACHER_GRANT_BLOCKED_MESSAGE =
  "Ce compte est lié à un élève actif. Le rôle Enseignant ne peut pas lui être attribué.";
