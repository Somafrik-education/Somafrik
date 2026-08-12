import { api } from "../api/client";

export type ClassStatus = "active" | "inactive";

export interface SchoolClass {
  id: string;
  publicId: string;
  classCode: string;
  name: string;
  level: string;
  section: string;
  track: string;
  status: ClassStatus;
  schoolCode: string;
  academicYearId: string;
  academicYearName: string;
  schoolYear: string;
  students: number;
  teacher?: string;
  presenceRate?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateClassPayload {
  name: string;
  academicYearName: string;
  level?: string;
  section?: string;
  status?: ClassStatus;
}

export interface UpdateClassPayload {
  name?: string;
  level?: string | null;
  section?: string | null;
  status?: ClassStatus;
}

export const classesApi = {
  list: () => api.get<SchoolClass[]>("/classes"),

  create: (payload: CreateClassPayload) => api.post<SchoolClass>("/classes", payload),

  update: (classCode: string, payload: UpdateClassPayload) =>
    api.patch<SchoolClass>(`/classes/${encodeURIComponent(classCode)}`, payload),
};
