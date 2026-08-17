import { api } from "../api/client";

export interface AcademicYear {
  id: string;
  schoolCode: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  isCurrent: boolean;
}

export const academicYearsApi = {
  list: () => api.get<AcademicYear[]>("/v2/academic-years"),
  create: (payload: { schoolCode?: string; name: string; startDate: string; endDate: string; isCurrent: boolean }) =>
    api.post<AcademicYear>("/v2/academic-years", payload),
  update: (
    id: string,
    payload: { name?: string; startDate?: string; endDate?: string; isCurrent?: boolean },
  ) => api.patch<AcademicYear>(`/v2/academic-years/${encodeURIComponent(id)}`, payload),
};
