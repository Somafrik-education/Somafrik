export type BusinessProfileKind = "student_login" | "teacher" | "staff" | "unassigned" | "conflict";

export type BusinessProfileUser = {
  accountKind?: string;
  linkedStudent?: { studentId?: string; studentCode?: string } | null;
  linkedTeacher?: { teacherId?: string; teacherCode?: string } | null;
  role?: string;
  roles?: string[];
  activeRoles?: string[];
  secondaryRoles?: string[];
  roleKeys?: string[];
  assignmentStatus?: string;
  businessProfileLabel?: string;
  businessProfileConflict?: boolean;
};

export const BUSINESS_PROFILE_KIND_LABELS: Record<BusinessProfileKind, string> = {
  student_login: "Compte lié à un élève",
  teacher: "Profil enseignant",
  staff: "Compte staff",
  unassigned: "Sans affectation",
  conflict: "Conflit élève + enseignant",
};

export const ACCESS_ROLES_NONE_LABEL = "Aucun rôle d'accès";

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

function accessRoleKeysOf(row: BusinessProfileUser): string[] {
  return (row.roleKeys ?? []).map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean);
}

function isEmptyAccessLabel(value?: string | null): boolean {
  const status = String(value ?? "").trim();
  return !status || status.toLowerCase() === "sans affectation";
}

export function isStudentLinkedAccount(row: BusinessProfileUser): boolean {
  if (row.accountKind === "student_login" || row.accountKind === "conflict") return true;
  if (row.linkedStudent?.studentId || row.linkedStudent?.studentCode) return true;
  if (accessRoleKeysOf(row).includes("STUDENT")) return true;
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
  if (row.linkedTeacher?.teacherId || row.linkedTeacher?.teacherCode) return true;
  if (accessRoleKeysOf(row).includes("TEACHER")) return true;
  return tokensOf(row).some((value) => value === "enseignant" || value === "teacher");
}

/** Type métier. Un élève lié n'est jamais « Sans affectation ». */
export function formatBusinessProfileKind(row: BusinessProfileUser): string {
  const keys = accessRoleKeysOf(row);
  const studentLinked =
    row.accountKind === "student_login" ||
    Boolean(row.linkedStudent?.studentId || row.linkedStudent?.studentCode) ||
    keys.includes("STUDENT");
  if (row.businessProfileLabel) {
    if (studentLinked && isEmptyAccessLabel(row.businessProfileLabel)) {
      return BUSINESS_PROFILE_KIND_LABELS.student_login;
    }
    return row.businessProfileLabel;
  }
  if (row.accountKind === "conflict" || row.businessProfileConflict) {
    return BUSINESS_PROFILE_KIND_LABELS.conflict;
  }
  if (
    row.accountKind === "student_login" ||
    row.linkedStudent?.studentId ||
    row.linkedStudent?.studentCode ||
    keys.includes("STUDENT")
  ) {
    return BUSINESS_PROFILE_KIND_LABELS.student_login;
  }
  if (
    row.accountKind === "teacher" ||
    row.linkedTeacher?.teacherId ||
    row.linkedTeacher?.teacherCode ||
    keys.includes("TEACHER")
  ) {
    return BUSINESS_PROFILE_KIND_LABELS.teacher;
  }
  if (row.accountKind === "staff" || keys.length) {
    return BUSINESS_PROFILE_KIND_LABELS.staff;
  }
  return BUSINESS_PROFILE_KIND_LABELS.unassigned;
}

/** Rôles d'accès uniquement. Distinct du type métier. */
export function formatAccessRolesDisplay(row: BusinessProfileUser): string {
  const labels = [
    ...(Array.isArray(row.activeRoles) ? row.activeRoles : []),
    ...(Array.isArray(row.roles) ? row.roles : []),
  ].filter((value) => String(value ?? "").trim() && String(value).toLowerCase() !== "sans affectation");
  if (labels.length > 0) return [...new Set(labels)].join(" · ");
  if (!isEmptyAccessLabel(row.assignmentStatus)) return String(row.assignmentStatus).trim();
  if (!isEmptyAccessLabel(row.role)) return String(row.role).trim();
  const keys = accessRoleKeysOf(row);
  if (keys.length) return keys.join(", ");
  return ACCESS_ROLES_NONE_LABEL;
}

export function accountKindLabel(row: BusinessProfileUser): string | null {
  const kind = formatBusinessProfileKind(row);
  if (kind === BUSINESS_PROFILE_KIND_LABELS.unassigned) return null;
  if (kind === BUSINESS_PROFILE_KIND_LABELS.staff) return null;
  return kind;
}

export const STUDENT_TEACHER_GRANT_BLOCKED_MESSAGE =
  "Ce compte est lié à un élève actif. Le rôle Enseignant ne peut pas lui être attribué.";
