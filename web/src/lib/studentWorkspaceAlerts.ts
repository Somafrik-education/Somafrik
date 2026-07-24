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
    | "hasCriticalAllergy"
    | "hasCriticalCondition"
    | "hasPhysician"
    | "hasBloodType"
    | "hasMedicalUpdate"
    | "hasMissingRequiredDocument"
    | "hasExpiredRequiredDocument"
    | "hasRejectedDocument"
    | "hasLowDocumentCompliance"
    | "hasImportantHistoryEvent"
    | "latestImportantHistoryEventTitle"
  >,
): StudentWorkspaceAlert[] {
  const alerts: StudentWorkspaceAlert[] = [];

  // Alertes médicales critiques en tête (priorité sécurité).
  if (overview.hasCriticalAllergy) {
    alerts.push({
      id: "critical-allergy",
      severity: "warning",
      message: "Allergie critique signalée",
      targetModuleId: "health",
    });
  }

  if (overview.hasCriticalCondition) {
    alerts.push({
      id: "critical-condition",
      severity: "warning",
      message: "Pathologie critique signalée",
      targetModuleId: "health",
    });
  }

  // Alertes documents (ordre : missing → expired → rejected → compliance).
  if (overview.hasMissingRequiredDocument) {
    alerts.push({
      id: "missing-required-document",
      severity: "warning",
      message: "Document obligatoire manquant",
      targetModuleId: "documents",
    });
  }

  if (overview.hasExpiredRequiredDocument) {
    alerts.push({
      id: "expired-required-document",
      severity: "warning",
      message: "Document obligatoire expiré",
      targetModuleId: "documents",
    });
  }

  if (overview.hasRejectedDocument) {
    alerts.push({
      id: "rejected-document",
      severity: "warning",
      message: "Document refusé",
      targetModuleId: "documents",
    });
  }

  if (overview.hasLowDocumentCompliance) {
    alerts.push({
      id: "low-document-compliance",
      severity: "info",
      message: "Conformité documentaire insuffisante",
      targetModuleId: "documents",
    });
  }

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

  if (!overview.hasPhysician) {
    alerts.push({
      id: "missing-physician",
      severity: "info",
      message: "Aucun médecin référent",
      targetModuleId: "health",
    });
  }

  if (!overview.hasMedicalUpdate) {
    alerts.push({
      id: "missing-medical-update",
      severity: "info",
      message: "Profil médical sans date de mise à jour",
      targetModuleId: "health",
    });
  }

  if (!overview.hasBloodType) {
    alerts.push({
      id: "missing-blood-type",
      severity: "info",
      message: "Groupe sanguin non renseigné",
      targetModuleId: "health",
    });
  }

  if (overview.hasImportantHistoryEvent) {
    alerts.push({
      id: "important-history-event",
      severity: "info",
      message: overview.latestImportantHistoryEventTitle
        ? `Dernier événement important : ${overview.latestImportantHistoryEventTitle}`
        : "Événement important dans l'historique",
      targetModuleId: "history",
    });
  }

  return alerts;
}
