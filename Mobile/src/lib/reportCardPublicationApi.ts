/**
 * LOT 8 — client lecture des publications authentifiées.
 * Tenant serveur-autoritaire. Aucun POST d'écriture.
 */
import { httpRequest } from "../services/httpClient";
import { downloadReportCardPdf } from "../services/api";
import type { SnapshotPayload } from "./reportCardSnapshotDisplay";
import { reportCardPresentationPath, type ReportCardPresentation } from "./reportCardPresentationMobile";

export type ReportCardPublicationRow = {
  event?: string;
  school_id?: string;
  report_card_id: string;
  public_id?: string;
  published_snapshot_version: number;
  verification_status?: string;
};

export type ReportCardPublicationSnapshot = {
  payload: SnapshotPayload;
  template?: unknown;
};

export function reportCardPublicationPdfPath(reportCardId: string, version: number | string) {
  return `/report-card/publications/${encodeURIComponent(reportCardId)}/pdf?version=${encodeURIComponent(String(version))}`;
}

export function reportCardPublicationSnapshotPath(reportCardId: string, version: number | string) {
  return `/report-card/publications/${encodeURIComponent(reportCardId)}/snapshot?version=${encodeURIComponent(String(version))}`;
}

export async function listReportCardPublications() {
  const data = await httpRequest<{ ok?: boolean; publications?: ReportCardPublicationRow[] }>(
    "/report-card/publications",
  );
  return Array.isArray(data?.publications) ? data.publications : [];
}

export async function getReportCardPublicationSnapshot(reportCardId: string, version: number | string) {
  const data = await httpRequest<{ ok?: boolean; payload?: SnapshotPayload; template?: unknown }>(
    reportCardPublicationSnapshotPath(reportCardId, version),
  );
  if (!data?.payload) return null;
  return { payload: data.payload, template: data.template } satisfies ReportCardPublicationSnapshot;
}

/**
 * BULLETIN-UI-01 — bulletin PUBLIÉ présenté par matières (lecture du snapshot figé).
 * null pour un bulletin historique sans totaux par matière.
 */
export async function getReportCardPresentation(reportCardId: string, version: number | string) {
  const data = await httpRequest<{ ok?: boolean; presentation?: ReportCardPresentation[] | null }>(
    reportCardPresentationPath(reportCardId, version),
  );
  return Array.isArray(data?.presentation) ? data.presentation : null;
}

export { downloadReportCardPdf };
