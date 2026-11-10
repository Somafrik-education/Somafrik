import { api } from "../api/client";

export type PublishedVersionRow = {
  report_card_id: string;
  school_id?: string;
  published_snapshot_version: number;
  verification_status: "ACTIVE" | "SUPERSEDED" | "REVOKED" | string;
  public_id?: string;
  snapshot_sha256?: string;
  signing_key_id?: string;
};

export type CorrectionBody = {
  sourceVersion: number;
  reason: string;
  commandId?: string;
};

export type RevokeBody = {
  reason: string;
  commandId?: string;
};


export type ReissuePreview = {
  ok: true;
  official: false;
  report_card_id: string;
  source_version: number;
  proposed_version: number;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  header: { title?: string; lines?: string[]; title_align?: string };
  signatures: string[];
  expected_draft_sha256: string;
  changes: { template: boolean; identity: boolean; grades: false };
};

export type ReissueBody = {
  sourceVersion: number;
  reason: string;
  commandId: string;
  expectedDraftSha256: string;
};

export const reportCardHistoryApi = {
  listHistory: (reportCardId: string) =>
    api.get<{ ok: boolean; versions: PublishedVersionRow[] }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/history`,
    ),
  getVersion: (reportCardId: string, version: number) =>
    api.get<{ ok: boolean; payload: unknown }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/versions/${encodeURIComponent(String(version))}`,
    ),
  previewReissue: (reportCardId: string, sourceVersion: number) =>
    api.post<ReissuePreview>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/reissues/preview`,
      { sourceVersion },
    ),
  reissue: (reportCardId: string, body: ReissueBody) =>
    api.post<{ ok: true; status: "REISSUED" | "ALREADY_REISSUED"; published_snapshot_version: number; public_id: string }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/reissues`,
      body,
    ),
  correct: (reportCardId: string, body: CorrectionBody) =>
    api.post<{ ok: boolean; publication: { public_id?: string; published_snapshot_version?: number } }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/corrections`,
      body,
    ),
  revoke: (reportCardId: string, version: number, body: RevokeBody) =>
    api.post<{ ok: boolean }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/versions/${encodeURIComponent(String(version))}/revoke`,
      body,
    ),
};
