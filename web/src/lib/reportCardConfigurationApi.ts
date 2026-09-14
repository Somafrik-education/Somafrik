import { api } from "../api/client";

export type ReportCardActions = {
  approve?: boolean;
  request_changes?: boolean;
  review?: boolean;
  configure?: boolean;
  ready?: boolean;
  reject?: boolean;
  activate?: boolean;
};

export type ReportCardRequest = {
  id: string;
  status: string;
  model_key?: string;
  school_id?: string;
  description?: string | null;
  actions?: ReportCardActions;
};

export const reportCardConfigurationApi = {
  listRequests: () => api.get<{ ok: boolean; requests: ReportCardRequest[] }>("/report-card/requests"),
  submitModel: (body: { modelKey: string; description?: string }) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>("/report-card/requests", body),
  getRequest: (requestId: string) =>
    api.get<{ ok: boolean; request: ReportCardRequest }>(`/report-card/requests/${encodeURIComponent(requestId)}`),
  approve: (requestId: string) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/requests/${encodeURIComponent(requestId)}/approve`,
      {},
    ),
  requestChanges: (requestId: string, comment?: string) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/requests/${encodeURIComponent(requestId)}/request-changes`,
      { comment },
    ),
  listAudit: (requestId: string) =>
    api.get<{ ok: boolean; audit: unknown[] }>(`/report-card/requests/${encodeURIComponent(requestId)}/audit`),
  getSnapshot: (reportCardId: string, version: number) =>
    api.get<{ ok: boolean; payload: unknown }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/snapshot?version=${encodeURIComponent(String(version))}`,
    ),
};

export const reportCardAdminApi = {
  queue: (schoolId: string, state?: string) => {
    const params = new URLSearchParams({ schoolId });
    if (state) params.set("state", state);
    return api.get<{ ok: boolean; requests: ReportCardRequest[] }>(`/report-card/admin/queue?${params.toString()}`);
  },
  getRequest: (requestId: string, schoolId: string) =>
    api.get<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}?schoolId=${encodeURIComponent(schoolId)}`,
    ),
  startReview: (requestId: string, schoolId: string) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/review`,
      { schoolId },
    ),
  startConfiguring: (requestId: string, schoolId: string) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/configure`,
      { schoolId },
    ),
  markReadyForReview: (requestId: string, schoolId: string) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/ready-for-review`,
      { schoolId },
    ),
  reject: (requestId: string, schoolId: string, reason?: string) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/reject`,
      { schoolId, reason },
    ),
  activate: (requestId: string, schoolId: string, commandId?: string) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/activate`,
      { schoolId, commandId },
    ),
  saveRenderingTemplate: (requestId: string, schoolId: string, spec: unknown) =>
    api.post<{ ok: boolean; template: unknown }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/save-template`,
      { schoolId, spec },
    ),
  bindBundle: (requestId: string, schoolId: string, bundle: Record<string, unknown>) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/bind-bundle`,
      { schoolId, ...bundle },
    ),
};
