import { api, requestBlob } from "../api/client";
import type { PublishedVersionRow } from "./reportCardHistoryApi";

export type ReportCardPublicationRow = {
  report_card_id: string;
  school_id?: string;
  public_id?: string;
  published_snapshot_version: number;
  verification_status?: string;
};

export type SnapshotCell = {
  subject_id?: string;
  period_id?: string;
  score_component_id?: string;
  exposed?: unknown;
  kind?: string;
};

export type SnapshotSlot = {
  slot?: string;
  kind?: string;
  exposed?: unknown;
  passed?: boolean;
  section_id?: string;
};

export type SnapshotPresence = {
  section_id?: string;
  column_id?: string;
  row_id?: string;
  field_kind?: string;
  field_id?: string;
  applicable?: boolean;
};

export type SnapshotStudent = {
  student_id?: string;
  cells?: SnapshotCell[];
  slots?: SnapshotSlot[];
  presence?: SnapshotPresence[];
};

export type SnapshotPayload = {
  report_card_id?: string;
  published_snapshot_version?: number;
  published_at?: string;
  students?: SnapshotStudent[];
};

export type RenderingSection = {
  id: string;
  label?: string;
  source: "cells" | "slots" | "presence";
};

export type RenderingTemplate = {
  paper?: string;
  orientation?: string;
  qr_required?: boolean;
  sections?: RenderingSection[];
};

export type ReportCardPublicationSnapshot = {
  payload: SnapshotPayload;
  template?: RenderingTemplate | null;
};

function publicationPath(reportCardId: string) {
  return "/report-card/publications/" + encodeURIComponent(reportCardId);
}

export const parentReportCardApi = {
  listPublications: async () => {
    const data = await api.get<{ ok?: boolean; publications?: ReportCardPublicationRow[] }>(
      "/report-card/publications",
    );
    return Array.isArray(data?.publications) ? data.publications : [];
  },
  getSnapshot: async (reportCardId: string, version: number) => {
    const data = await api.get<{
      ok?: boolean;
      payload?: SnapshotPayload;
      template?: RenderingTemplate | null;
    }>(
      publicationPath(reportCardId) +
        "/snapshot?version=" +
        encodeURIComponent(String(version)),
    );
    if (!data?.payload) return null;
    return {
      payload: data.payload,
      template: data.template ?? null,
    } satisfies ReportCardPublicationSnapshot;
  },
  getVersion: async (reportCardId: string, version: number) => {
    const data = await api.get<{
      ok?: boolean;
      payload?: SnapshotPayload;
      template?: RenderingTemplate | null;
    }>(
      publicationPath(reportCardId) +
        "/versions/" +
        encodeURIComponent(String(version)),
    );
    if (!data?.payload) return null;
    return {
      payload: data.payload,
      template: data.template ?? null,
    } satisfies ReportCardPublicationSnapshot;
  },
  listHistory: async (reportCardId: string) => {
    const data = await api.get<{ ok?: boolean; versions?: PublishedVersionRow[] }>(
      publicationPath(reportCardId) + "/history",
    );
    return Array.isArray(data?.versions) ? data.versions : [];
  },
  pdf: (reportCardId: string, version: number) =>
    requestBlob(
      publicationPath(reportCardId) +
        "/pdf?version=" +
        encodeURIComponent(String(version)),
    ),
};
