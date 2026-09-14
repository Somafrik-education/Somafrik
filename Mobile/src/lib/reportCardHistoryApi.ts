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
