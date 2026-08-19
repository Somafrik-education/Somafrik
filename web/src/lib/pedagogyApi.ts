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

export type CourseScheduleOccurrenceProjection = {
  projection: "occurrences";
  from: string;
  to: string;
  timeZone: string;
  items: unknown[];
};

export const pedagogyApi = {
  listCourses: () => api.get<unknown[]>("/courses"),
  createCourse: (payload: Record<string, unknown>) => api.post("/courses", payload),
  updateCourse: (courseId: string, payload: Record<string, unknown>) =>
    api.patch(`/courses/${encodeURIComponent(courseId)}`, payload),
  deleteCourse: (courseId: string) => api.delete(`/courses/${encodeURIComponent(courseId)}`),

  /** Définitions weekly (sans from/to). */
  listCourseSchedules: () => api.get<unknown[]>("/course-schedules"),
  /**
   * Cours planifiables canoniques — gated Planning de cours:READ,
   * indépendant du domaine Web `courses` / `Matières:READ`.
   */
  listPlanningCourseOptions: (query?: {
    classId?: string;
    className?: string;
    academicYearId?: string;
  }) =>
    api.get<{ projection: "planning-course-options"; items: unknown[] }>(
      withQuery("/course-schedules", {
        projection: "course-options",
        classId: query?.classId,
        className: query?.className,
        academicYearId: query?.academicYearId,
      }),
    ),
  /** Projection datée serveur — source de vérité du calendrier /planning. */
  listCourseScheduleOccurrences: (query: {
    from: string;
    to: string;
    academicYearId?: string;
    classId?: string;
    teacherId?: string;
    schoolCourseId?: string;
  }) =>
    api.get<CourseScheduleOccurrenceProjection>(
      withQuery("/course-schedules", {
        from: query.from,
        to: query.to,
        academicYearId: query.academicYearId,
        classId: query.classId,
        teacherId: query.teacherId,
        schoolCourseId: query.schoolCourseId,
      }),
    ),
  createCourseSchedule: (payload: Record<string, unknown>) => api.post("/course-schedules", payload),
  updateCourseSchedule: (scheduleId: string, payload: Record<string, unknown>) =>
    api.patch(`/course-schedules/${encodeURIComponent(scheduleId)}`, payload),
  deleteCourseSchedule: (scheduleId: string) =>
    api.delete(`/course-schedules/${encodeURIComponent(scheduleId)}`),

  createEvaluation: (payload: Record<string, unknown>) => api.post("/evaluations", payload),
  listEvaluations: () => api.get<unknown[]>("/evaluations"),
  updateEvaluation: (evaluationId: string, payload: Record<string, unknown>) =>
    api.patch(`/evaluations/${encodeURIComponent(evaluationId)}`, payload),

  upsertNote: (payload: Record<string, unknown>) => api.post("/notes", payload),
  upsertPresences: (payload: Record<string, unknown>) => api.post("/presences", payload),
};
