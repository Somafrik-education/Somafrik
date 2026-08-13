import { api } from "../api/client";

export const pedagogyApi = {
  listCourses: () => api.get<unknown[]>("/courses"),
  createCourse: (payload: Record<string, unknown>) => api.post("/courses", payload),
  updateCourse: (courseId: string, payload: Record<string, unknown>) =>
    api.patch(`/courses/${encodeURIComponent(courseId)}`, payload),
  deleteCourse: (courseId: string) => api.delete(`/courses/${encodeURIComponent(courseId)}`),

  listCourseSchedules: () => api.get<unknown[]>("/course-schedules"),
  createCourseSchedule: (payload: Record<string, unknown>) => api.post("/course-schedules", payload),
  updateCourseSchedule: (scheduleId: string, payload: Record<string, unknown>) =>
    api.patch(`/course-schedules/${encodeURIComponent(scheduleId)}`, payload),
  deleteCourseSchedule: (scheduleId: string) =>
    api.delete(`/course-schedules/${encodeURIComponent(scheduleId)}`),

  createEvaluation: (payload: Record<string, unknown>) => api.post("/evaluations", payload),
  updateEvaluation: (evaluationId: string, payload: Record<string, unknown>) =>
    api.patch(`/evaluations/${encodeURIComponent(evaluationId)}`, payload),

  upsertNote: (payload: Record<string, unknown>) => api.post("/notes", payload),
  upsertPresences: (payload: Record<string, unknown>) => api.post("/presences", payload),
};
