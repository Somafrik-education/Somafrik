/**
 * LOT 9 — lecture seule de l'historique des versions publiées.
 * Aucune écriture. Aucun recalcul.
 */
import { httpRequest } from "../services/httpClient";

export type PublishedVersionRow = {
  report_card_id: string;
  published_snapshot_version: number;
  verification_status?: string;
  public_id?: string;
  snapshot_sha256?: string;
  signing_key_id?: string;
};

export function publishedVersionHistoryPath(reportCardId: string) {
  return `/report-card/publications/${encodeURIComponent(reportCardId)}/history`;
}

export async function listPublishedVersionHistory(reportCardId: string) {
  const data = await httpRequest<{ ok?: boolean; versions?: PublishedVersionRow[] }>(
    publishedVersionHistoryPath(reportCardId),
  );
  return Array.isArray(data?.versions) ? data.versions : [];
}

/** BULLETIN-REEMISSION-01 — l’API ne réémet jamais à la lecture. */
export type ReissuePreview = {
  ok: true;
  source_version: number;
  proposed_version: number;
  student_id: string;
  header: { title?: string; lines?: string[] };
  signatures: string[];
  expected_draft_sha256: string;
};

export function reissuePath(reportCardId: string) {
  return `/report-card/publications/${encodeURIComponent(reportCardId)}/reissues`;
}

export async function previewReportCardReissue(reportCardId: string, sourceVersion: number) {
  return httpRequest<ReissuePreview>(`${reissuePath(reportCardId)}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceVersion }),
  });
}

export async function publishReportCardReissue(
  reportCardId: string,
  body: { sourceVersion: number; reason: string; commandId: string; expectedDraftSha256: string },
) {
  return httpRequest<{ ok: true; status: "REISSUED" | "ALREADY_REISSUED"; published_snapshot_version: number }>(
    reissuePath(reportCardId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
