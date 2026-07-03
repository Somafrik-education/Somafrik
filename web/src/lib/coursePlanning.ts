import type { BackOfficeState, SessionUser } from "../types";
import { getSubjectsForClass } from "./academicConfig";
import { normalize } from "./format";
import { scopedCourses, scopedTeachers } from "./establishment";

export interface CourseScheduleSlot {
  id: string;
  schoolCode: string;
  className: string;
  subject: string;
  teacherId?: string;
  teacherName?: string;
  start: string;
  end: string;
  room?: string;
}

export interface PlanningResource {
  id: string;
  title: string;
  subject: string;
  teacherName: string;
  teacherId?: string;
}

export interface PlanningCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  resourceId: string;
  extendedProps: CourseScheduleSlot;
  backgroundColor?: string;
  borderColor?: string;
}

const RESOURCE_COLORS = ["#0d9488", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#0891b2"];

function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash + key.charCodeAt(i) * (i + 1)) % RESOURCE_COLORS.length;
  return RESOURCE_COLORS[hash] ?? RESOURCE_COLORS[0];
}

export function scopedCourseSchedules(user: SessionUser | null, state: BackOfficeState): CourseScheduleSlot[] {
  const schoolCode = user?.schoolCode;
  const rows = (state.courseSchedules ?? []) as CourseScheduleSlot[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

export function getClassSubjectNames(
  user: SessionUser | null,
  state: BackOfficeState,
  className: string,
  schoolCode?: string,
): string[] {
  if (!className.trim()) return [];

  const fromCourses = scopedCourses(user, state)
    .filter((row) => normalize(String(row.className ?? "")) === normalize(className))
    .map((row) => String(row.name ?? row.subject ?? "").trim())
    .filter(Boolean);

  const unique = [...new Set(fromCourses)];
  if (unique.length) {
    return unique.sort((a, b) => a.localeCompare(b, "fr"));
  }

  return getSubjectsForClass(state, schoolCode, className);
}

export function filterSlotsByClass(slots: CourseScheduleSlot[], className: string): CourseScheduleSlot[] {
  if (!className.trim()) return [];
  return slots.filter((slot) => normalize(slot.className) === normalize(className));
}

function teacherDisplayName(row: Record<string, unknown> | undefined): string {
  if (!row) return "Non assigné";
  const label = String(row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim());
  return label || "Non assigné";
}

export function resolveCourseTeacher(
  state: BackOfficeState,
  user: SessionUser | null,
  className: string,
  subject: string,
): { teacherId: string; teacherName: string } {
  const course = findCourseAssignment(state, user, className, subject);
  const teachers = scopedTeachers(user, state);
  const teacherId = String(course?.teacherId ?? "");
  let teacherName = String(course?.teacherName ?? "").trim();
  if (!teacherName && teacherId) {
    teacherName = teacherDisplayName(teachers.find((row) => String(row.id) === teacherId) as Record<string, unknown>);
  }
  return { teacherId, teacherName: teacherName || "Non assigné" };
}

/** Ressources du calendrier = une ligne par matière avec enseignant assigné. */
export function buildClassSubjectResources(
  className: string,
  user: SessionUser | null,
  state: BackOfficeState,
  schoolCode?: string,
): PlanningResource[] {
  return getClassSubjectNames(user, state, className, schoolCode).map((subject) => {
    const { teacherId, teacherName } = resolveCourseTeacher(state, user, className, subject);
    return {
      id: subject,
      title: subject,
      subject,
      teacherName,
      teacherId,
    };
  });
}

export function slotsToClassCalendarEvents(
  slots: CourseScheduleSlot[],
  className: string,
): PlanningCalendarEvent[] {
  return filterSlotsByClass(slots, className).map((slot) => {
    const resourceId = slot.subject;
    const color = colorForKey(resourceId);
    const teacher = slot.teacherName || "Non assigné";
    const room = slot.room ? ` · ${slot.room}` : "";

    return {
      id: slot.id,
      title: `${slot.subject} — ${teacher}${room}`,
      start: slot.start,
      end: slot.end,
      resourceId,
      extendedProps: slot,
      backgroundColor: color,
      borderColor: color,
    };
  });
}

export function formatSlotLabel(slot: CourseScheduleSlot): string {
  const teacher = slot.teacherName ? ` — ${slot.teacherName}` : "";
  return `${slot.subject} (${slot.className})${teacher}`;
}

export function detectScheduleConflicts(
  slots: CourseScheduleSlot[],
  candidate: CourseScheduleSlot,
  ignoreId?: string,
): string[] {
  const start = new Date(candidate.start).getTime();
  const end = new Date(candidate.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return ["L'heure de fin doit être postérieure à l'heure de début."];
  }

  const issues: string[] = [];
  for (const slot of slots) {
    if (ignoreId && slot.id === ignoreId) continue;
    const slotStart = new Date(slot.start).getTime();
    const slotEnd = new Date(slot.end).getTime();
    const overlaps = start < slotEnd && end > slotStart;
    if (!overlaps) continue;

    if (candidate.teacherId && slot.teacherId && candidate.teacherId === slot.teacherId) {
      issues.push(`Conflit enseignant : ${slot.subject} (${slot.className}).`);
    }
    if (normalize(candidate.className) === normalize(slot.className)) {
      issues.push(`Conflit sur ${slot.className} : ${slot.subject} à cet horaire.`);
    }
  }
  return [...new Set(issues)];
}

export function createScheduleId(): string {
  return `CS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function mergeCourseSchedules(
  state: BackOfficeState,
  schoolCode: string,
  nextSchoolSlots: CourseScheduleSlot[],
): CourseScheduleSlot[] {
  const others = ((state.courseSchedules ?? []) as CourseScheduleSlot[]).filter(
    (row) => normalize(row.schoolCode) !== normalize(schoolCode),
  );
  return [...others, ...nextSchoolSlots];
}

export function findCourseAssignment(
  state: BackOfficeState,
  user: SessionUser | null,
  className: string,
  subject: string,
) {
  return scopedCourses(user, state).find(
    (row) =>
      normalize(String(row.className ?? "")) === normalize(className) &&
      normalize(String(row.name ?? row.subject ?? "")) === normalize(subject),
  );
}
