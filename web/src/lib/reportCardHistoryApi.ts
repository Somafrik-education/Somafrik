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

export const reportCardHistoryApi = {
  listHistory: (reportCardId: string) =>
    api.get<{ ok: boolean; versions: PublishedVersionRow[] }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/history`,
    ),
  getVersion: (reportCardId: string, version: number) =>
    api.get<{ ok: boolean; payload: unknown }>(
      `/report-card/publications/${encodeURIComponent(reportCardId)}/versions/${encodeURIComponent(String(version))}`,
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
