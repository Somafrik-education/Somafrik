import { api } from "../api/client";
import type { BulletinClassDesign } from "./bulletinDesign";

export type CanonicalReportCard = {
  id: string;
  schoolCode: string;
  studentId: string;
  studentName?: string;
  className?: string;
  period?: string;
  status: string;
  average?: number | null;
};

export type CanonicalReportCardTemplate = {
  id: string;
  schoolCode: string;
  classId?: string | null;
  className?: string | null;
  templateType: string;
  layout: BulletinClassDesign | Record<string, unknown>;
  status: string;
  version: number;
};

export const reportCardsApi = {
  list: () => api.get<{ bulletins: CanonicalReportCard[] }>("/report-cards"),
  generate: (payload: Record<string, unknown>) => api.post<CanonicalReportCard>("/report-cards/generate", payload),
  publish: (cardId: string) =>
    api.post<CanonicalReportCard>(`/report-cards/${encodeURIComponent(cardId)}/publish`, {}),
  archive: (cardId: string) =>
    api.post<CanonicalReportCard>(`/report-cards/${encodeURIComponent(cardId)}/archive`, {}),
};

export const reportCardTemplatesApi = {
  list: () => api.get<{ templates: CanonicalReportCardTemplate[] }>("/report-card-templates"),
  upsert: (payload: Record<string, unknown>) =>
    api.put<CanonicalReportCardTemplate>("/report-card-templates", payload),
  archive: (templateId: string) =>
    api.post<CanonicalReportCardTemplate>(
      `/report-card-templates/${encodeURIComponent(templateId)}/archive`,
      {},
    ),
};
