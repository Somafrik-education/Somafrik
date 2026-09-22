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
  teacherId?: string;
  headTeacher?: {
    teacherCode: string;
    firstName?: string;
    lastName?: string;
    displayName: string;
    status?: string | null;
  } | null;
  headTeacherCode?: string | null;
  headTeacherFirstName?: string | null;
  headTeacherLastName?: string | null;
  headTeacherDisplayName?: string | null;
  headTeacherStatus?: string | null;
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

  listHeadTeacherCandidates: (classCode: string, q?: string) => {
    const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    return api.get<HeadTeacherCandidate[]>(
      `/classes/${encodeURIComponent(classCode)}/head-teacher/candidates${query}`,
    );
  },

  assignHeadTeacher: (classCode: string, teacherCode: string) =>
    api.put<SchoolClass>(`/classes/${encodeURIComponent(classCode)}/head-teacher`, { teacherCode }),

  removeHeadTeacher: (classCode: string) =>
    api.delete<SchoolClass>(`/classes/${encodeURIComponent(classCode)}/head-teacher`),
};

export type HeadTeacherCandidate = {
  teacherCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  assignedToCurrentClass?: boolean;
  otherClassNames?: string[];
  alreadyHeadTeacherHint?: string;
};
