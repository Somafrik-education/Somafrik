import { api } from "../api/client";

export interface SchoolStudentEnrollment {
  id: string;
  status: string;
  enrollmentDate: string;
  classCode: string;
  className: string;
  academicYearName: string;
  academicYearStatus?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SchoolStudentDocument {
  id: string;
  documentCode: string;
  documentType: string;
  title: string;
  format: string;
  version: string;
  status: string;
  generatedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SchoolStudentAccess {
  notesPath: string;
  presencesPath: string;
  paymentsPath: string;
  reportPath: string;
}

export interface SchoolStudent {
  id: string;
  publicId: string;
  studentCode: string;
  matricule: string;
  firstName: string;
  lastName: string;
  name: string;
  gender: string;
  birthDate: string;
  birthPlace?: string;
  photoUrl?: string;
  className: string;
  classCode: string;
  schoolCode: string;
  parentPhone: string;
  parentEmail: string;
  status: string;
  enrollmentId: string | null;
  enrollmentDate: string;
  academicYearName: string;
  createdAt?: string;
  updatedAt?: string;
  enrollments?: SchoolStudentEnrollment[];
  guardians?: unknown[];
  medical?: {
    allergies?: string[];
    conditions?: string[];
    medications?: string[];
    notes?: string;
    emergencyContact?: string;
    bloodType?: string;
  };
  documents?: SchoolStudentDocument[];
  access?: SchoolStudentAccess;
}

export interface UpdateSchoolStudentPayload {
  firstName?: string;
  lastName?: string;
  gender?: string | null;
  birthDate?: string | null;
  birthPlace?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  expectedUpdatedAt: string;
}

export const studentsApi = {
  list: () => api.get<SchoolStudent[]>("/students"),

  get: (studentCode: string) =>
    api.get<SchoolStudent>(`/students/${encodeURIComponent(studentCode)}`),

  update: (studentCode: string, payload: UpdateSchoolStudentPayload) =>
    api.patch<SchoolStudent>(`/students/${encodeURIComponent(studentCode)}`, payload),
};
