import { formatDateForDisplay } from "./dates";
import { isSchoolAdminRole } from "./format";
import type { GuidedSetupPayload } from "./schoolSetupGuidedApi";

export const GUIDED_STEP_TOTAL = 10;

export const GUIDED_STEP_KEYS = [
  "establishment",
  "academicYear",
  "structure",
  "subjects",
  "teachers",
  "students",
  "finance",
  "pedagogy",
  "communication",
  "users",
] as const;

export const GUIDED_MOBILE_LINKS = {
  establishment: "EstablishmentProfile",
  academicYear: "SchoolYearSettings",
  structure: "SchoolPedagogicalStructure",
  subjects: "SchoolPedagogicalStructure",
  teachers: "Teachers",
  students: "Classes",
  finance: "FeeGrids",
  pedagogy: "SchoolYearSettings",
  communication: "SchoolNotificationSettings",
  users: "Users",
} as const;

export const GUIDED_STEP_COPY: Record<(typeof GUIDED_STEP_KEYS)[number], { title: string; description: string }> = {
  establishment: {
    title: "Informations établissement",
    description: "Nom, pays, adresse, téléphone, logo et devise du profil canonique.",
  },
  academicYear: {
    title: "Année scolaire",
    description: "Année active et dates de début / fin.",
  },
  structure: {
    title: "Structure pédagogique",
    description: "Niveaux, groupes puis classes via les écrans existants.",
  },
  subjects: {
    title: "Matières",
    description: "Matières et relations avec les niveaux et classes.",
  },
  teachers: {
    title: "Enseignants",
    description: "Comptes enseignants, affectations classes / matières.",
  },
  students: {
    title: "Élèves",
    description: "Ouvrez une classe puis « Inscrire un élève ». Aucune création globale.",
  },
  finance: {
    title: "Finance",
    description: "Frais, tarifs, échéances et moyens de paiement existants.",
  },
  pedagogy: {
    title: "Paramètres pédagogiques",
    description: "Créez au moins un type d'évaluation (devoir, interrogation, examen…) dans l'année scolaire.",
  },
  communication: {
    title: "Communication",
    description: "Annonces et paramètres de notification existants.",
  },
  users: {
    title: "Utilisateurs et droits",
    description: "Administrateurs, enseignants, rôles et permissions RBAC.",
  },
};

export interface GuidedSetupGateInput {
  payload?: GuidedSetupPayload | null;
  role?: string;
  mustChangePassword?: boolean;
}

export function guidedProgressLabel(payload: Pick<GuidedSetupPayload, "percent">) {
  return `Configuration ${payload.percent} % terminée`;
}

export function guidedStepHeading(step: number) {
  return `Étape ${step} sur ${GUIDED_STEP_TOTAL}`;
}

export function guidedNextStepLabel(payload: Pick<GuidedSetupPayload, "nextStepLabel">) {
  return payload.nextStepLabel ?? "";
}

export function guidedResumeStep(payload: Pick<GuidedSetupPayload, "currentStep">) {
  return payload.currentStep;
}

export function shouldShowSchoolSetupWelcome(input: GuidedSetupGateInput = {}) {
  if (input.mustChangePassword) return false;
  if (!isSchoolAdminRole(input.role)) return false;
  if (!input.payload) return false;
  if (input.payload.finalized) return false;
  return input.payload.status === "configuration_required" && input.payload.percent === 0;
}

export function shouldShowGuidedSetupDashboardCard(input: GuidedSetupGateInput = {}) {
  if (!isSchoolAdminRole(input.role)) return false;
  if (!input.payload) return false;
  if (input.payload.finalized) return false;
  return input.payload.percent < 100;
}

/**
 * AUDIT-SETUP-GUIDED-10-01 / O3 — `finalizedAt` reste un historique. La conformité
 * d'aujourd'hui est le `status` recalculé par le Backend sur les données actuelles.
 */
export function guidedFinalizedState(
  payload: Pick<GuidedSetupPayload, "finalized" | "finalizedAt" | "status" | "nextStepLabel">,
): { compliant: boolean; finalizedOn: string; stepToFix: string | null } | null {
  if (!payload.finalized) return null;
  const compliant = payload.status === "operational";
  return {
    compliant,
    finalizedOn: formatDateForDisplay(payload.finalizedAt ?? null),
    stepToFix: compliant ? null : payload.nextStepLabel ?? null,
  };
}
