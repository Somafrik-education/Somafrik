import type { BackOfficeState, SessionUser } from "../types";
import type { CourseScheduleSlot } from "./coursePlanning";
import { scopedClasses, scopedCourses } from "./establishment";
import { planningLabelsMatch } from "./planningTextRepair";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalSchoolCourseId(row: Record<string, unknown> | undefined | null): string {
  if (!row) return "";
  for (const key of ["schoolCourseId", "dbId", "id"] as const) {
    const value = String(row[key] ?? "").trim();
    if (UUID_RE.test(value)) return value;
  }
  return "";
}

export function isArchivedSchoolCourse(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? "")
    .trim()
    .toLowerCase();
  return status === "archived" || status === "archivé";
}

export interface PlanningSchoolCourseOption {
  schoolCourseId: string;
  className: string;
  name: string;
  teacherId: string;
  teacherName: string;
  classId: string;
}

export function listSchoolCoursesForClass(
  user: SessionUser | null,
  state: BackOfficeState,
  className: string,
): PlanningSchoolCourseOption[] {
  if (!className.trim()) return [];
  const options: PlanningSchoolCourseOption[] = [];
  const seen = new Set<string>();
  for (const row of scopedCourses(user, state) as Record<string, unknown>[]) {
    if (isArchivedSchoolCourse(row)) continue;
    if (!planningLabelsMatch(String(row.className ?? ""), className)) continue;
    const schoolCourseId = canonicalSchoolCourseId(row);
    const name = String(row.name ?? row.subject ?? row.course ?? "").trim();
    if (!schoolCourseId || !name || seen.has(schoolCourseId)) continue;
    seen.add(schoolCourseId);
    options.push({
      schoolCourseId,
      className: String(row.className ?? className),
      name,
      teacherId: String(row.teacherId ?? ""),
      teacherName: String(row.teacherName ?? "").trim(),
      classId: String(row.classId ?? ""),
    });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function resolveClassAcademicYearId(
  user: SessionUser | null,
  state: BackOfficeState,
  className: string,
): string {
  const klass = scopedClasses(user, state).find((row) =>
    planningLabelsMatch(String(row.name ?? ""), className),
  ) as Record<string, unknown> | undefined;
  return String(klass?.academicYearId ?? "").trim();
}

/**
 * Payload d'écriture Planning V2.
 * className / subject / start / end ne sont jamais une autorité.
 */
export function toWeeklyScheduleWritePayload(slot: CourseScheduleSlot): Record<string, unknown> {
  const schoolCourseId = String(slot.schoolCourseId ?? "").trim();
  const academicYearId = String(slot.academicYearId ?? "").trim();
  const dayOfWeek = Number(slot.dayOfWeek);
  const startTime = String(slot.startTime ?? "").trim().slice(0, 5);
  const endTime = String(slot.endTime ?? "").trim().slice(0, 5);

  if (!schoolCourseId) {
    throw new Error("schoolCourseId obligatoire : className + subject ne sont plus une autorité.");
  }
  if (!academicYearId) {
    throw new Error("academicYearId obligatoire.");
  }
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    throw new Error("dayOfWeek obligatoire (1 = lundi … 7 = dimanche).");
  }
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error("startTime et endTime obligatoires (HH:MM).");
  }
  if (endTime <= startTime) {
    throw new Error("endTime doit être strictement postérieur à startTime.");
  }

  const payload: Record<string, unknown> = {
    schoolCourseId,
    academicYearId,
    dayOfWeek,
    startTime,
    endTime,
  };
  const room = String(slot.room ?? "").trim();
  if (room) payload.room = room;
  return payload;
}
