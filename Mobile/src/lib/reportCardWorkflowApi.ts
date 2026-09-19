/**
 * LOT 5 — lecture seule du workflow modèle bulletin.
 * GET /report-card/requests uniquement. Aucune écriture.
 */
import { httpRequest } from "../services/httpClient";

export type ReportCardWorkflowRequest = {
  id: string;
  status: string;
  model_key?: string;
  description?: string | null;
  academic_year?: string | null;
  period?: string | null;
  ready?: boolean;
  active?: boolean;
};

export async function listReportCardRequests() {
  const data = await httpRequest<{ ok?: boolean; requests?: ReportCardWorkflowRequest[] }>(
    "/report-card/requests",
  );
  return Array.isArray(data?.requests) ? data.requests : [];
}
