import { api } from "../api/client";

export interface AcademicYear {
  id: string;
  /** UUID établissement = schools.id. Autorité de scope, jamais leftover school_code. */
  schoolId?: string;
  /** Projection publique = schools.login_code. Jamais une autorité de sécurité. */
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
