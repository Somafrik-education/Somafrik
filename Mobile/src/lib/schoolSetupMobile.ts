import { isSchoolAdminRole } from "./format";
import type { SchoolSetupCore, SchoolSetupPayload } from "./schoolSetupStatusApi";

export const SCHOOL_SETUP_ROUTE = "SchoolSetup" as const;

export const SCHOOL_SETUP_MOBILE_LINKS = {
  academicYear: "SchoolYearSettings",
  structure: "SchoolPedagogicalStructure",
  classes: "Classes",
  teachers: "Users",
} as const;

export interface SchoolSetupWizardStep {
  id: string;
  label: string;
  to: (typeof SCHOOL_SETUP_MOBILE_LINKS)[keyof typeof SCHOOL_SETUP_MOBILE_LINKS];
  disabled: boolean;
  done: boolean;
}

export interface SchoolSetupWizardGateInput {
  payload?: SchoolSetupPayload | null;
  role?: string;
  mustChangePassword?: boolean;
}

let wizardDismissedThisSession = false;

export function resetSchoolSetupWizardSessionDismiss() {
  wizardDismissedThisSession = false;
}

export function dismissSchoolSetupWizardForSession() {
  wizardDismissedThisSession = true;
}

export function isSchoolSetupWizardDismissedThisSession() {
  return wizardDismissedThisSession;
}

export function isSchoolSetupClassesStepEnabled(core: SchoolSetupCore) {
  return Boolean(core?.academicYear);
}

export function schoolSetupWizardSteps(payload: SchoolSetupPayload): SchoolSetupWizardStep[] {
  const core = payload.core;
  const optional = payload.optional ?? {};
  return [
    {
      id: "academicYear",
      label: "Année scolaire",
      to: SCHOOL_SETUP_MOBILE_LINKS.academicYear,
      disabled: false,
      done: Boolean(core.academicYear),
    },
    {
      id: "structure",
      label: "Structure pédagogique",
      to: SCHOOL_SETUP_MOBILE_LINKS.structure,
      disabled: !core.academicYear,
      done: Boolean(core.structure),
    },
    {
      id: "classes",
      label: "Classes",
      to: SCHOOL_SETUP_MOBILE_LINKS.classes,
      disabled: !isSchoolSetupClassesStepEnabled(core) || !core.structure,
      done: Boolean(core.classes),
    },
    {
      id: "teachers",
      label: "Comptes utilisateurs",
      to: SCHOOL_SETUP_MOBILE_LINKS.teachers,
      disabled: false,
      done: Boolean(optional.teachers),
    },
  ];
}

export function shouldShowDashboardSetupWidget(input: SchoolSetupWizardGateInput = {}) {
  if (!isSchoolAdminRole(input.role)) return false;
  const status = input.payload?.status;
  return status === "NOT_STARTED" || status === "IN_PROGRESS";
}

export function dashboardSetupProgressLabel(payload: SchoolSetupPayload) {
  const done = payload.progress?.coreDone ?? 0;
  const total = payload.progress?.coreTotal ?? 3;
  return `${done} / ${total}`;
}
