import { api } from "../api/client";

export type ClassStatus = "active" | "inactive";

export interface SchoolClass {
  id: string;
  classId?: string | null;
  publicId: string;
  classCode: string;
  name: string;
  className?: string;
  level: string;
  section: string;
  track: string;
  groupCode: string;
  groupId?: string | null;
  levelId?: string | null;
  streamId?: string | null;
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
  academicYearId: string;
  levelId: string;
  streamId?: string | null;
  groupId: string;
  status?: ClassStatus;
}

export interface UpdateClassPayload {
  levelId?: string;
  streamId?: string | null;
  groupId?: string;
  status?: ClassStatus;
}

export const classesApi = {
  list: () => api.get<SchoolClass[]>("/classes"),

  create: (payload: CreateClassPayload) => api.post<SchoolClass>("/classes", payload),

  update: (classCode: string, payload: UpdateClassPayload) =>
    api.patch<SchoolClass>(`/classes/${encodeURIComponent(classCode)}`, payload),
};
