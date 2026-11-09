/** BULLETIN-REEMISSION-01 — écriture explicite, séparée de l'historique read-only LOT 5/9. */
import { httpRequest } from "../services/httpClient";

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
