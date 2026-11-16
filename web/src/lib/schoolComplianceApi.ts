import { api } from "../api/client";

export type SchoolErasureStatus = "pending" | "processed" | "rejected";

export type SchoolErasureRequest = {
  id: string;
  requestCode: string;
  schoolCode: string;
  identifier: string;
  contactEmail: string;
  roleLabel: string;
  requestType: string;
  status: SchoolErasureStatus | string;
  reason: string;
  actorUserId: string | null;
  processedAt: string | null;
  createdAt: string;
};

export type SchoolErasureExecutionResult = {
  request: SchoolErasureRequest;
  sessionsRevoked: number;
  accountAnonymized: boolean;
  schoolRecordsRetained: boolean;
};

export type SchoolDataExportPayload = {
  format: string;
  version: number;
  generatedAt: string;
  schoolCode: string;
  includedDomains: string[];
  domains: Record<string, unknown>;
};

export function listSchoolErasureRequests() {
  return api.get<SchoolErasureRequest[]>("/privacy/erasure-requests");
}

export function executeSchoolErasureRequest(requestId: string) {
  return api.post<SchoolErasureExecutionResult>(
    `/privacy/erasure-requests/${encodeURIComponent(requestId)}/execute`,
  );
}

export function exportSchoolData() {
  return api.get<SchoolDataExportPayload>("/data-export");
}
