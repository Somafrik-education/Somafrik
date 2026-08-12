import { api } from "../api/client";

export interface ClassStudent {
  id: string;
  publicId: string;
  studentCode: string;
  matricule: string;
  firstName: string;
  lastName: string;
  name: string;
  gender: string;
  birthDate: string;
  className: string;
  classCode: string;
  schoolCode: string;
  parentPhone: string;
  parentEmail: string;
  status: string;
  enrollmentId: string | null;
  enrollmentDate: string;
  academicYearName: string;
}

export interface EnrollClassStudentPayload {
  firstName: string;
  lastName: string;
  gender?: string;
  birthDate?: string;
  parentPhone?: string;
  parentEmail?: string;
}

export const classStudentsApi = {
  list: (classCode: string) =>
    api.get<ClassStudent[]>(`/classes/${encodeURIComponent(classCode)}/students`),

  enroll: (classCode: string, payload: EnrollClassStudentPayload) =>
    api.post<ClassStudent>(`/classes/${encodeURIComponent(classCode)}/students`, payload),

  get: (studentCode: string) =>
    api.get<ClassStudent>(`/students/${encodeURIComponent(studentCode)}`),
};
