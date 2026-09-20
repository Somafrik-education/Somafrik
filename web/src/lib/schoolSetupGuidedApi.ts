import { api } from "../api/client";

export type GuidedSetupStatus = "configuration_required" | "operational";

export interface GuidedSetupStep {
  key: string;
  index: number;
  label: string;
  done: boolean;
  unlocked: boolean;
}

export interface GuidedSetupPayload {
  schoolId: string;
  status: GuidedSetupStatus;
  percent: number;
  currentStep: number;
  lastValidStep: number;
  nextStepKey: string | null;
  nextStepLabel: string | null;
  completedSteps: string[];
  steps: GuidedSetupStep[];
  updatedAt: string | null;
}

/** Client JWT-scoped : /v2/school-setup/guided (tenant via Bearer, jamais schoolCode). */
export const schoolSetupGuidedApi = {
  get: () => api.get<GuidedSetupPayload>("/v2/school-setup/guided"),
  completeStep: (stepKey: string) =>
    api.post<GuidedSetupPayload>(`/v2/school-setup/guided/steps/${encodeURIComponent(stepKey)}/complete`),
};
