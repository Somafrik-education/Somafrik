import type { StudentWorkspaceOverview } from "./studentWorkspaceOverview";
import type { StudentWorkspaceModuleId } from "./studentWorkspace";

export type StudentWorkspaceAlertSeverity = "warning" | "info";

export interface StudentWorkspaceAlert {
  id: string;
  severity: StudentWorkspaceAlertSeverity;
  message: string;
  targetModuleId: StudentWorkspaceModuleId;
}

export function buildStudentWorkspaceAlerts(
  overview: Pick<
    StudentWorkspaceOverview,
    | "gender"
    | "birthDate"
    | "phone"
    | "email"
    | "nationality"
    | "enrollmentStatus"
    | "currentClassName"
    | "hasGuardians"
    | "guardiansCount"
  >,
): StudentWorkspaceAlert[] {
  const alerts: StudentWorkspaceAlert[] = [];

  if (!overview.enrollmentStatus) {
    alerts.push({
      id: "missing-active-enrollment",
      severity: "warning",
      message: "Aucune inscription active",
      targetModuleId: "enrollments",
    });
  } else if (!overview.currentClassName) {
    alerts.push({
      id: "missing-class",
      severity: "warning",
      message: "Classe actuelle non renseignée",
      targetModuleId: "enrollments",
    });
  }

  if (!overview.hasGuardians || overview.guardiansCount <= 0) {
    alerts.push({
      id: "missing-guardians",
      severity: "warning",
      message: "Aucun responsable associé",
      targetModuleId: "guardians",
    });
  }

  if (!overview.phone && !overview.email) {
    alerts.push({
      id: "missing-contact",
      severity: "warning",
      message: "Aucun moyen de contact renseigné",
      targetModuleId: "identity",
    });
  }

  const missingIdentityFields: string[] = [];
  if (!overview.gender) missingIdentityFields.push("sexe");
  if (!overview.birthDate) missingIdentityFields.push("date de naissance");
  if (!overview.nationality) missingIdentityFields.push("nationalité");

  if (missingIdentityFields.length > 0) {
    alerts.push({
      id: "missing-identity-fields",
      severity: "info",
      message: `Données manquantes : ${missingIdentityFields.join(", ")}`,
      targetModuleId: "identity",
    });
  }

  return alerts;
}
