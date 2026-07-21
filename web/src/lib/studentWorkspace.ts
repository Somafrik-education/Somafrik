export type StudentWorkspaceModuleId =
  | "overview"
  | "identity"
  | "enrollments"
  | "guardians"
  | "attendance"
  | "grades"
  | "finance"
  | "documents"
  | "health"
  | "discipline"
  | "history"
  | "access";

export type StudentWorkspacePermission =
  | "student.overview.read"
  | "student.identity.read"
  | "student.enrollments.read"
  | "student.enrollments.create"
  | "student.enrollments.update"
  | "student.enrollments.validate"
  | "student.enrollments.assign-class"
  | "student.enrollments.transfer"
  | "student.enrollments.close"
  | "student.guardians.read"
  | "student.guardians.create"
  | "student.guardians.update"
  | "student.guardians.delete"
  | "student.attendance.read"
  | "student.grades.read"
  | "student.finance.read"
  | "student.documents.read"
  | "student.documents.upload"
  | "student.documents.verify"
  | "student.documents.delete"
  | "student.health.read"
  | "student.medical.read"
  | "student.medical.update"
  | "student.medical.validate"
  | "student.discipline.read"
  | "student.history.read"
  | "student.history.export"
  | "student.history.audit"
  | "student.access.read";

export interface StudentWorkspaceModule {
  id: StudentWorkspaceModuleId;
  title: string;
  icon: string;
  enabledByDefault: boolean;
  requiredPermission: StudentWorkspacePermission;
}

export const STUDENT_WORKSPACE_MODULES = [
  {
    id: "overview",
    title: "Vue d'ensemble",
    icon: "layout-dashboard",
    enabledByDefault: true,
    requiredPermission: "student.overview.read",
  },
  {
    id: "identity",
    title: "Identité",
    icon: "user-round",
    enabledByDefault: true,
    requiredPermission: "student.identity.read",
  },
  {
    id: "enrollments",
    title: "Inscription",
    icon: "graduation-cap",
    enabledByDefault: true,
    requiredPermission: "student.enrollments.read",
  },
  {
    id: "guardians",
    title: "Responsables",
    icon: "users-round",
    enabledByDefault: true,
    requiredPermission: "student.guardians.read",
  },
  {
    id: "health",
    title: "Médical",
    icon: "heart-pulse",
    enabledByDefault: true,
    requiredPermission: "student.medical.read",
  },
  {
    id: "documents",
    title: "Documents",
    icon: "files",
    enabledByDefault: true,
    requiredPermission: "student.documents.read",
  },
  {
    id: "attendance",
    title: "Présences",
    icon: "calendar-check",
    enabledByDefault: true,
    requiredPermission: "student.attendance.read",
  },
  {
    id: "grades",
    title: "Résultats",
    icon: "chart-no-axes-column",
    enabledByDefault: true,
    requiredPermission: "student.grades.read",
  },
  {
    id: "finance",
    title: "Finances",
    icon: "wallet-cards",
    enabledByDefault: true,
    requiredPermission: "student.finance.read",
  },
  {
    id: "discipline",
    title: "Discipline",
    icon: "shield-alert",
    enabledByDefault: false,
    requiredPermission: "student.discipline.read",
  },
  {
    id: "history",
    title: "Historique",
    icon: "history",
    enabledByDefault: true,
    requiredPermission: "student.history.read",
  },
  {
    id: "access",
    title: "Accès",
    icon: "key-round",
    enabledByDefault: false,
    requiredPermission: "student.access.read",
  },
] as const satisfies readonly StudentWorkspaceModule[];

export function getStudentWorkspaceModule(
  moduleId: StudentWorkspaceModuleId,
): StudentWorkspaceModule {
  const module = STUDENT_WORKSPACE_MODULES.find(
    (candidate) => candidate.id === moduleId,
  );

  if (!module) {
    throw new Error(`Unknown student workspace module: ${moduleId}`);
  }

  return module;
}

export function getDefaultStudentWorkspaceModules(): readonly StudentWorkspaceModule[] {
  return STUDENT_WORKSPACE_MODULES.filter(
    (module) => module.enabledByDefault,
  );
}
