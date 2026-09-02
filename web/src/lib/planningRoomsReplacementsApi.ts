import { api } from "../api/client";

function withQuery(path: string, query?: Record<string, string | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) params.set(key, trimmed);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export type SchoolRoom = {
  id: string;
  roomCode: string;
  name: string;
  capacity: number | null;
  roomType: string;
  building: string;
  floor: string;
  equipment: string[];
  status: string;
  occupationToday: number;
  classSize?: number | null;
  capacityWarning?: { roomCapacity: number; classSize: number; message: string } | null;
};

export const schoolRoomsApi = {
  list: (query?: { status?: string; search?: string; type?: string; capacity?: string; classId?: string }) =>
    api.get<{ items: SchoolRoom[] }>(
      withQuery("/school-rooms", {
        status: query?.status,
        search: query?.search,
        type: query?.type,
        capacity: query?.capacity,
        classId: query?.classId,
      }),
    ),
  create: (payload: Record<string, unknown>) => api.post<SchoolRoom>("/school-rooms", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<SchoolRoom>(`/school-rooms/${encodeURIComponent(id)}`, payload),
  archive: (id: string) => api.delete<SchoolRoom>(`/school-rooms/${encodeURIComponent(id)}`),
};

export type CourseScheduleReplacement = {
  id: string;
  weeklySlotId: string;
  occurrenceDate: string;
  originalTeacherId: string;
  originalTeacherName: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
  className: string;
  courseName: string;
  startTime: string;
  endTime: string;
  room: string;
  reason: string;
  status: string;
};

export type SubstituteOption = {
  teacherId: string;
  teacherCode: string;
  name: string;
  speciality: string;
  availability: "available" | "schedule_conflict" | "subject_mismatch";
  selectable: boolean;
  courses: { className: string; subject: string }[];
};

export const replacementsApi = {
  list: (query?: Record<string, string | undefined>) =>
    api.get<{ items: CourseScheduleReplacement[] }>(withQuery("/course-schedule-replacements", query)),
  options: (query: { weeklySlotId: string; occurrenceDate: string }) =>
    api.get<{
      weeklySlotId: string;
      occurrenceDate: string;
      originalTeacherId: string;
      originalTeacherName: string;
      items: SubstituteOption[];
    }>(
      withQuery("/course-schedule-replacements/options", {
        weeklySlotId: query.weeklySlotId,
        occurrenceDate: query.occurrenceDate,
      }),
    ),
  create: (payload: Record<string, unknown>) =>
    api.post<CourseScheduleReplacement>("/course-schedule-replacements", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<CourseScheduleReplacement>(
      `/course-schedule-replacements/${encodeURIComponent(id)}`,
      payload,
    ),
  cancel: (id: string) =>
    api.delete<CourseScheduleReplacement>(`/course-schedule-replacements/${encodeURIComponent(id)}`),
};
