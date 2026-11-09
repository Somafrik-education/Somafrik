import { api } from "../api/client";

export type TeacherAssignmentPayload = {
  teacherCode?: string;
  teacherId?: string;
  classCode?: string;
  className?: string;
  subjectCode?: string;
  subject?: string;
  course?: string;
  assignmentRole?: string;
};

export type TeacherAssignmentRecord = {
  id: string;
  teacherId: string;
  className: string;
  course: string;
  subject?: string;
  status?: string;
};

function canonicalPayload(payload: TeacherAssignmentPayload): TeacherAssignmentPayload {
  const canonical = { ...payload } as TeacherAssignmentPayload & Record<string, unknown>;
  delete canonical.schoolCode;
  delete canonical.schoolId;
  delete canonical.academicYearId;
  delete canonical.id;
  return canonical;
}

export const teacherAssignmentsApi = {
  list: () => api.get<TeacherAssignmentRecord[]>("/assignments"),
  create: (payload: TeacherAssignmentPayload) =>
    api.post<Record<string, unknown>>("/assignments", canonicalPayload(payload)),
  update: (assignmentId: string, payload: TeacherAssignmentPayload) =>
    api.patch<Record<string, unknown>>(
      `/assignments/${encodeURIComponent(assignmentId)}`,
      canonicalPayload(payload),
    ),
  remove: (assignmentId: string) =>
    api.delete<{ id: string; deleted: boolean }>(
      `/assignments/${encodeURIComponent(assignmentId)}`,
    ),
};
