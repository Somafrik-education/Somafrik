import { api } from "../api/client";

export interface SchoolTeacher {
  id: string;
  teacherCode: string;
  publicId: string;
  identifier: string;
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

export const teachersApi = {
  list: () => api.get<SchoolTeacher[]>("/teachers"),

  get: (teacherCode: string) =>
    api.get<SchoolTeacher>(`/teachers/${encodeURIComponent(teacherCode)}`),

  create: (payload: CreateTeacherPayload) => api.post<SchoolTeacher>("/teachers", payload),
};
