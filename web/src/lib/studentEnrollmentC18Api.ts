import { api } from "../api/client";
import type { StudentEnrollmentStatus } from "./studentEnrollmentStatus";

export type C18Enrollment = {
  id: string;
  studentId: string;
  status: StudentEnrollmentStatus | string;
  classId: string | null;
  classCode: string;
  className: string;
  academicYearId?: string | null;
  academicYearName: string;
  enrollmentDate: string;
  validatedAt?: string | null;
  assignedAt?: string | null;
  transferredAt?: string | null;
  transferDestination?: string | null;
  transferNotes?: string | null;
  closedAt?: string | null;
  closeNotes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function path(studentId: string, enrollmentId: string, action: string) {
  return `/students/${encodeURIComponent(studentId)}/enrollments/${encodeURIComponent(enrollmentId)}/${action}`;
}

export const studentEnrollmentC18Api = {
  list: async (studentId: string) => {
    const payload = await api.get<{ items?: C18Enrollment[] } | C18Enrollment[]>(
      `/students/${encodeURIComponent(studentId)}/enrollments`,
    );
    if (Array.isArray(payload)) return payload;
    return payload?.items ?? [];
  },
  validate: (studentId: string, enrollmentId: string, body: { reason?: string } = {}) =>
    api.post<C18Enrollment>(path(studentId, enrollmentId, "validate"), body),
  assignClass: (
    studentId: string,
    enrollmentId: string,
    body: { classId?: string; classCode?: string; effectiveDate?: string },
  ) => api.post<C18Enrollment>(path(studentId, enrollmentId, "assign-class"), body),
  transfer: (
    studentId: string,
    enrollmentId: string,
    body: { destinationSchoolName: string; reason?: string },
  ) => api.post<C18Enrollment>(path(studentId, enrollmentId, "transfer"), body),
  close: (
    studentId: string,
    enrollmentId: string,
    body: { reason?: string } = {},
  ) => api.post<C18Enrollment>(path(studentId, enrollmentId, "close"), body),
};
