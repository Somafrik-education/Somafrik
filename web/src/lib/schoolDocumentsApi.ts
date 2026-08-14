import { api } from "../api/client";

export type CanonicalSchoolDocument = {
  id: string;
  schoolCode: string;
  studentId?: string | null;
  studentName?: string;
  documentType: string;
  title: string;
  status: string;
};

export const schoolDocumentsApi = {
  list: () => api.get<{ documents: CanonicalSchoolDocument[] }>("/school-documents"),
  create: (payload: Record<string, unknown>) => api.post<CanonicalSchoolDocument>("/school-documents", payload),
  patch: (documentId: string, payload: Record<string, unknown>) =>
    api.patch<CanonicalSchoolDocument>(`/school-documents/${encodeURIComponent(documentId)}`, payload),
  archive: (documentId: string) =>
    api.post<CanonicalSchoolDocument>(`/school-documents/${encodeURIComponent(documentId)}/archive`, {}),
};
