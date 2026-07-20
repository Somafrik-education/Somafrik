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
    | "hasActiveEnrollment"
    | "enrollmentIsIncomplete"
    | "enrollmentApprovedWithoutClass"
    | "enrollmentActiveWithoutDate"
    | "hasDuplicateActiveEnrollments"
    | "enrollmentYearMismatch"
    | "hasLegalGuardian"
    | "hasGuardianPhone"
    | "hasEmergencyContact"
    | "hasFinancialResponsible"
    | "multiplePriorityOneGuardians"
    | "multipleFinancialResponsibles"
    | "hasExpiredGuardianRelation"
  >,
): StudentWorkspaceAlert[] {
  const alerts: StudentWorkspaceAlert[] = [];

  if (!overview.hasActiveEnrollment || !overview.enrollmentStatus) {
    alerts.push({
      id: "missing-active-enrollment",
      severity: "warning",
      message: "Aucune inscription active",
      targetModuleId: "enrollments",
    });
  } else {
    if (overview.enrollmentIsIncomplete) {
      alerts.push({
        id: "incomplete-pre-enrollment",
        severity: "warning",
        message: "Dossier de préinscription incomplet",
        targetModuleId: "enrollments",
      });
    }

    if (overview.enrollmentApprovedWithoutClass) {
      alerts.push({
        id: "approved-without-class",
        severity: "warning",
        message: "Inscription validée sans classe",
        targetModuleId: "enrollments",
      });
    }

    if (
      overview.enrollmentStatus === "ENROLLED" &&
      !overview.currentClassName
    ) {
      alerts.push({
        id: "enrolled-without-class",
        severity: "warning",
        message: "Inscription active sans classe affectée",
        targetModuleId: "enrollments",
      });
    }

    if (overview.enrollmentActiveWithoutDate) {
      alerts.push({
        id: "active-without-enrollment-date",
        severity: "info",
        message: "Inscription active sans date d'inscription",
        targetModuleId: "enrollments",
      });
    }
  }

  if (overview.hasDuplicateActiveEnrollments) {
    alerts.push({
      id: "duplicate-active-enrollments",
      severity: "warning",
      message: "Plusieurs inscriptions actives détectées",
      targetModuleId: "enrollments",
    });
  }

  if (overview.enrollmentYearMismatch) {
    alerts.push({
      id: "enrollment-year-mismatch",
      severity: "info",
      message: "Année scolaire incohérente",
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
  } else {
    if (!overview.hasLegalGuardian) {
      alerts.push({
        id: "missing-legal-guardian",
        severity: "warning",
        message: "Aucun responsable légal",
        targetModuleId: "guardians",
      });
    }

    if (!overview.hasGuardianPhone) {
      alerts.push({
        id: "missing-guardian-phone",
        severity: "warning",
        message: "Aucun téléphone de responsable",
        targetModuleId: "guardians",
      });
    }

    if (!overview.hasEmergencyContact) {
      alerts.push({
        id: "missing-emergency-contact",
        severity: "warning",
        message: "Aucun contact d'urgence",
        targetModuleId: "guardians",
      });
    }

    if (!overview.hasFinancialResponsible) {
      alerts.push({
        id: "missing-financial-responsible",
        severity: "warning",
        message: "Aucun responsable financier",
        targetModuleId: "guardians",
      });
    }

    if (overview.multiplePriorityOneGuardians) {
      alerts.push({
        id: "multiple-priority-one-guardians",
        severity: "warning",
        message: "Plusieurs responsables avec priorité 1",
        targetModuleId: "guardians",
      });
    }

    if (overview.multipleFinancialResponsibles) {
      alerts.push({
        id: "multiple-financial-responsibles",
        severity: "info",
        message: "Plusieurs responsables financiers",
        targetModuleId: "guardians",
      });
    }

    if (overview.hasExpiredGuardianRelation) {
      alerts.push({
        id: "expired-guardian-relation",
        severity: "info",
        message: "Relation responsable expirée",
        targetModuleId: "guardians",
      });
    }
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
