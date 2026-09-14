import { api, request } from "../api/client";

export type ReportCardActions = {
  approve?: boolean;
  request_changes?: boolean;
  review?: boolean;
  configure?: boolean;
  save_template?: boolean;
  bind_bundle?: boolean;
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
  profile_id?: string | null;
  profile_version?: number | null;
  schema_id?: string | null;
  schema_version?: number | null;
  rendering_template_id?: string | null;
  rendering_template_version?: number | null;
  actions?: ReportCardActions;
};

export type ReportCardCatalogEntry = {
  id: string;
  profile_key?: string;
  schema_key?: string;
  version: number;
  status?: string;
  spec_sha256?: string;
};

export type ReportCardBundle = {
  ok: boolean;
  request: ReportCardRequest;
  template: { spec?: unknown; version?: number; status?: string } | null;
  profile: { id: string; version: number; status?: string } | null;
  schema: { id: string; version: number; status?: string } | null;
};

export type ReportCardAuditEntry = {
  id?: number | string;
  from_state?: string | null;
  to_state?: string;
  actor_id?: string;
  permission?: string;
  reason?: string | null;
};

export type ReportCardSourceArtifact = {
  artifact_id: string;
  request_id?: string;
  school_id?: string;
  version?: number;
  sha256?: string;
  media_type?: string;
  original_filename?: string;
  current?: boolean;
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
    api.get<{ ok: boolean; audit: ReportCardAuditEntry[] }>(
      `/report-card/requests/${encodeURIComponent(requestId)}/audit`,
    ),
  getBundle: (requestId: string) =>
    api.get<ReportCardBundle>(`/report-card/requests/${encodeURIComponent(requestId)}/bundle`),
  getActiveBinding: (modelKey: string) =>
    api.get<{ ok: boolean; binding: Record<string, unknown> }>(
      `/report-card/bindings/${encodeURIComponent(modelKey)}`,
    ),
  getSnapshot: (reportCardId: string, version: number) =>
    api.get<{ ok: boolean; payload: unknown }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/snapshot?version=${encodeURIComponent(String(version))}`,
    ),
  getSourceArtifact: (requestId: string) =>
    api.get<{ ok: boolean; artifact: ReportCardSourceArtifact }>(
      `/report-card/requests/${encodeURIComponent(requestId)}/source-artifact`,
    ),
  attachSourceArtifact: (requestId: string, file: File) =>
    request<{ ok: boolean; artifact: ReportCardSourceArtifact }>(
      `/report-card/requests/${encodeURIComponent(requestId)}/source-artifact`,
      {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/pdf",
          "X-Idempotency-Key":
            globalThis.crypto && "randomUUID" in globalThis.crypto
              ? globalThis.crypto.randomUUID()
              : `upload-${Date.now()}`,
          "X-Somafrik-Original-Filename": file.name || "modele.pdf",
        },
        body: file,
      },
    ),
};

export const reportCardAdminApi = {
  queue: (schoolId: string, state?: string) => {
    const params = new URLSearchParams({ schoolId });
    if (state) params.set("state", state);
    return api.get<{ ok: boolean; requests: ReportCardRequest[] }>(`/report-card/admin/queue?${params.toString()}`);
  },
  catalog: (schoolId: string) =>
    api.get<{ ok: boolean; profiles: ReportCardCatalogEntry[]; schemas: ReportCardCatalogEntry[] }>(
      `/report-card/admin/catalog?schoolId=${encodeURIComponent(schoolId)}`,
    ),
  getRequest: (requestId: string, schoolId: string) =>
    api.get<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}?schoolId=${encodeURIComponent(schoolId)}`,
    ),
  getBundle: (requestId: string, schoolId: string) =>
    api.get<ReportCardBundle>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/bundle?schoolId=${encodeURIComponent(schoolId)}`,
    ),
  getSourceArtifact: (requestId: string, schoolId: string) =>
    api.get<{ ok: boolean; artifact: ReportCardSourceArtifact }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/source-artifact?schoolId=${encodeURIComponent(schoolId)}`,
    ),
  getActiveBinding: (modelKey: string, schoolId: string) =>
    api.get<{ ok: boolean; binding: Record<string, unknown> }>(
      `/report-card/admin/bindings/${encodeURIComponent(modelKey)}?schoolId=${encodeURIComponent(schoolId)}`,
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
    api.post<{ ok: boolean; template: { template_id: string; version: number } }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/save-template`,
      { schoolId, spec },
    ),
  bindBundle: (requestId: string, schoolId: string, bundle: Record<string, unknown>) =>
    api.post<{ ok: boolean; request: ReportCardRequest }>(
      `/report-card/admin/requests/${encodeURIComponent(requestId)}/bind-bundle`,
      { schoolId, ...bundle },
    ),
};
