import { api } from "../api/client";

export type CanonicalExam = {
  id: string;
  schoolCode: string;
  name: string;
  classId?: string;
  className?: string;
  subjectId?: string;
  subject?: string;
  examType?: string;
  date?: string;
  period?: string;
  status?: string;
  statusCode?: string;
};

export const examsApi = {
  list: () => api.get<{ exams: CanonicalExam[] }>("/exams"),
  get: (examId: string) => api.get<CanonicalExam>(`/exams/${encodeURIComponent(examId)}`),
  create: (payload: Record<string, unknown>) => api.post<CanonicalExam>("/exams", payload),
  patch: (examId: string, payload: Record<string, unknown>) =>
    api.patch<CanonicalExam>(`/exams/${encodeURIComponent(examId)}`, payload),
  validate: (examId: string) => api.post<CanonicalExam>(`/exams/${encodeURIComponent(examId)}/validate`, {}),
  cancel: (examId: string) => api.post<CanonicalExam>(`/exams/${encodeURIComponent(examId)}/cancel`, {}),
  archive: (examId: string) => api.post<CanonicalExam>(`/exams/${encodeURIComponent(examId)}/archive`, {}),
};
