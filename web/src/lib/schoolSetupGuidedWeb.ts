import { isSchoolAdminRole } from "./format";
import type { GuidedSetupPayload } from "./schoolSetupGuidedApi";

export const SCHOOL_SETUP_WELCOME_PATH = "/bienvenue-etablissement";
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

export const GUIDED_WEB_LINKS = {
  establishment: "/parametres/profil",
  academicYear: "/parametres/annee-scolaire",
  structure: "/parametres/structure",
  subjects: "/parametres/structure",
  teachers: "/etablissement/enseignants",
  students: "/etablissement/classes",
  finance: "/finances/frais",
  pedagogy: "/notes",
  communication: "/parametres/notifications",
  users: "/etablissement/comptes-utilisateurs",
} as const;

export const GUIDED_STEP_COPY: Record<
  (typeof GUIDED_STEP_KEYS)[number],
  { title: string; description: string; cta: string }
> = {
  establishment: {
    title: "Informations établissement",
    description: "Nom, pays, adresse, téléphone, logo et devise déjà portés par le profil canonique.",
    cta: "Ouvrir le profil établissement",
  },
  academicYear: {
    title: "Année scolaire",
    description: "Année active, dates de début et de fin, périodes si déjà supportées.",
    cta: "Ouvrir l'année scolaire",
  },
  structure: {
    title: "Structure pédagogique",
    description: "Cycles, niveaux puis classes via les workflows canoniques existants.",
    cta: "Ouvrir la structure pédagogique",
  },
  subjects: {
    title: "Matières",
    description: "Configurer les matières et leurs relations avec les niveaux et les classes.",
    cta: "Ouvrir les matières",
  },
  teachers: {
    title: "Enseignants",
    description: "Créer les enseignants depuis les comptes, puis les affecter aux classes et matières.",
    cta: "Ouvrir les enseignants",
  },
  students: {
    title: "Élèves",
    description: "L'inscription suit la règle Classe → Élève. Ouvrez une classe puis « Inscrire un élève ».",
    cta: "Ouvrir les classes pour inscrire",
  },
  finance: {
    title: "Finance",
    description: "Accès guidé aux frais scolaires, tarifs, échéances et moyens de paiement existants.",
    cta: "Ouvrir les frais et tarifs",
  },
  pedagogy: {
    title: "Paramètres pédagogiques",
    description: "Accès guidé aux notes, présences, coefficients et bulletins déjà disponibles.",
    cta: "Ouvrir les notes",
  },
  communication: {
    title: "Communication",
    description: "Accès guidé aux annonces, notifications et paramètres de communication existants.",
    cta: "Ouvrir les notifications",
  },
  users: {
    title: "Utilisateurs et droits",
    description: "Contrôle des administrateurs, enseignants, rôles et permissions RBAC actuelles.",
    cta: "Ouvrir les comptes utilisateurs",
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
  return input.payload.status === "configuration_required" && input.payload.percent === 0;
}

export function shouldShowGuidedSetupDashboardCard(input: GuidedSetupGateInput = {}) {
  if (!isSchoolAdminRole(input.role)) return false;
  if (!input.payload) return false;
  return input.payload.percent < 100;
}
