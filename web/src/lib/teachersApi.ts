import { api } from "../api/client";

export interface TeacherAssignmentSummary {
  id?: string | null;
  classId?: string | null;
  className: string;
  classCode?: string;
  course: string;
  subjectCode?: string;
  status?: string;
}

export interface SchoolTeacher {
  id: string;
  teacherCode: string;
  publicId: string;
  identifier: string;
  userId?: string | null;
  firstName: string;
  lastName: string;
  name: string;
  gender: string;
  birthDate: string;
  entryDate: string;
  phone: string;
  email: string;
  speciality: string;
  mainSubject: string;
  schoolCode: string;
  status: string;
  mustChangePassword?: boolean;
  assignments?: TeacherAssignmentSummary[];
  assignedClasses?: string[];
  courses?: string[];
}

export interface CreateTeacherPayload {
  firstName: string;
  lastName: string;
  gender?: string;
  birthDate: string;
  entryDate?: string;
  phone?: string;
  email?: string;
  speciality?: string;
  temporaryPassword: string;
}

export interface UpdateTeacherPayload {
  firstName?: string;
  lastName?: string;
  gender?: string | null;
  birthDate?: string;
  entryDate?: string;
  phone?: string | null;
  email?: string | null;
  speciality?: string | null;
}

export const teachersApi = {
  list: () => api.get<SchoolTeacher[]>("/teachers"),

  get: (teacherCode: string) =>
    api.get<SchoolTeacher>(`/teachers/${encodeURIComponent(teacherCode)}`),

  create: (payload: CreateTeacherPayload) => api.post<SchoolTeacher>("/teachers", payload),

  update: (teacherCode: string, payload: UpdateTeacherPayload) =>
    api.patch<SchoolTeacher>(`/teachers/${encodeURIComponent(teacherCode)}`, payload),

  remove: (teacherCode: string) =>
    api.delete<{ teacherCode: string; archived: boolean }>(
      `/teachers/${encodeURIComponent(teacherCode)}`,
    ),
};
