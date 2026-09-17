import { httpRequest } from "../services/httpClient";

export type SchoolSetupStatus = "NOT_STARTED" | "IN_PROGRESS" | "READY";

export interface SchoolSetupCore {
  academicYear: boolean;
  structure: boolean;
  classes: boolean;
}

export interface SchoolSetupProgress {
  coreDone: number;
  coreTotal: number;
}

export interface SchoolSetupPayload {
  status: SchoolSetupStatus;
  core: SchoolSetupCore;
  optional?: Record<string, boolean>;
  progress: SchoolSetupProgress;
}

/** Client JWT-scoped : GET /v2/school-setup/status (tenant via Bearer, jamais schoolCode). */
export const schoolSetupStatusApi = {
  get: () => httpRequest<SchoolSetupPayload>("/v2/school-setup/status"),
};
