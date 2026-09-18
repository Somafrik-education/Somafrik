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

export type SchoolSetupOptionalUiId = "periods" | "teachers" | "students" | "feeGrids" | "notifications";

export interface SchoolSetupOptionalCompletenessItem {
  id: SchoolSetupOptionalUiId;
  label: string;
  done: boolean;
}

const SCHOOL_SETUP_OPTIONAL_UI_ITEMS: ReadonlyArray<{
  id: SchoolSetupOptionalUiId;
  label: string;
}> = [
  { id: "periods", label: "Périodes scolaires" },
  { id: "teachers", label: "Enseignants" },
  { id: "students", label: "Élèves" },
  { id: "feeGrids", label: "Grilles tarifaires" },
  { id: "notifications", label: "Notifications" },
];

export function schoolSetupOptionalCompleteness(
  payload: SchoolSetupPayload,
): SchoolSetupOptionalCompletenessItem[] {
  const optional = payload.optional;
  return SCHOOL_SETUP_OPTIONAL_UI_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    done: Boolean(optional?.[item.id]),
  }));
}

export function schoolSetupWizardSteps(payload: SchoolSetupPayload): SchoolSetupWizardStep[] {
  const core = payload.core;
  const optional = payload.optional;
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
      done: Boolean(optional?.teachers),
    },
  ];
}

export function shouldAutoOpenSchoolSetupWizard(input: SchoolSetupWizardGateInput = {}) {
  if (input.mustChangePassword) return false;
  if (isSchoolSetupWizardDismissedThisSession()) return false;
  if (!isSchoolAdminRole(input.role)) return false;
  return input.payload?.status === "NOT_STARTED";
}

export type MobilePostLoginDestination = "Home" | "SchoolSetup";

export interface MobilePostLoginNavigation {
  fetchStatus: boolean;
  destinations: MobilePostLoginDestination[];
}

export async function resolveMobilePostLoginNavigation(input: {
  role?: string;
  mustChangePassword?: boolean;
  getStatus?: () => Promise<SchoolSetupPayload>;
}): Promise<MobilePostLoginNavigation> {
  if (input.mustChangePassword) {
    return { fetchStatus: false, destinations: [] };
  }
  if (!isSchoolAdminRole(input.role)) {
    return { fetchStatus: false, destinations: ["Home"] };
  }
  if (typeof input.getStatus !== "function") {
    return { fetchStatus: false, destinations: ["Home"] };
  }
  try {
    const payload = await input.getStatus();
    const open = shouldAutoOpenSchoolSetupWizard({
      payload,
      role: input.role,
      mustChangePassword: false,
    });
    return { fetchStatus: true, destinations: open ? ["Home", "SchoolSetup"] : ["Home"] };
  } catch {
    return { fetchStatus: true, destinations: ["Home"] };
  }
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
