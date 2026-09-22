import { httpRequest } from "../services/httpClient";

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

const GUIDED_PATH = "/v2/school-setup/guided";

/** Client JWT-scoped : tenant via Bearer, jamais schoolCode. */
export const schoolSetupGuidedApi = {
  get: () => httpRequest<GuidedSetupPayload>(GUIDED_PATH),
  completeStep: (stepKey: string) =>
    httpRequest<GuidedSetupPayload>(`${GUIDED_PATH}/steps/${encodeURIComponent(stepKey)}/complete`, {
      method: "POST",
    }),
};
