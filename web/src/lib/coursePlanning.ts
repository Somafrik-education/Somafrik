import type { BackOfficeState, SessionUser } from "../types";
import { getSubjectsForClass, DEFAULT_SUBJECTS } from "./academicConfig";
import { normalize } from "./format";
import { findTeacherByName, getTeacherDisplayName } from "./pedagogySync";
import { scopedAssignments, scopedCourses, scopedTeachers } from "./establishment";

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

export interface PlanningCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
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

export function uniqueSortedSubjects(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const subject = String(raw ?? "").trim();
    if (!subject) continue;
    const key = normalize(subject);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(subject);
  }
  return result.sort((a, b) => a.localeCompare(b, "fr"));
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

  const fromSlots = scopedCourseSchedules(user, state)
    .filter((slot) => normalize(slot.className) === normalize(className))
    .map((slot) => slot.subject.trim())
    .filter(Boolean);

  const fromConfig = getSubjectsForClass(state, schoolCode, className);

  const merged = uniqueSortedSubjects([...fromCourses, ...fromSlots, ...fromConfig]);
  if (merged.length) return merged;

  return [...DEFAULT_SUBJECTS];
}

export function filterSlotsByClass(slots: CourseScheduleSlot[], className: string): CourseScheduleSlot[] {
  if (!className.trim()) return [];
  return slots.filter((slot) => normalize(slot.className) === normalize(className));
}

function teacherDisplayName(row: Record<string, unknown> | undefined): string {
  if (!row) return "Non assigné";
  return getTeacherDisplayName(row) || "Non assigné";
}

export interface ResolvedCourseTeacher {
  teacherId: string;
  teacherName: string;
  /** Professeur issu de l'affectation cours / matière pour cette classe. */
  fromCourse: boolean;
}

function matchesClassSubject(
  row: Record<string, unknown>,
  className: string,
  subject: string,
): boolean {
  const classNorm = normalize(className);
  const subjectNorm = normalize(subject);
  const rowClass = normalize(String(row.className ?? ""));
  const rowSubject = normalize(String(row.name ?? row.subject ?? row.course ?? ""));
  return rowClass === classNorm && rowSubject === subjectNorm;
}

export function findCourseAssignment(
  state: BackOfficeState,
  user: SessionUser | null,
  className: string,
  subject: string,
): Record<string, unknown> | undefined {
  if (!className.trim() || !subject.trim()) return undefined;

  const course = scopedCourses(user, state).find((row) => matchesClassSubject(row, className, subject));
  if (course) return course;

  const assignment = scopedAssignments(user, state).find((row) => matchesClassSubject(row, className, subject));
  if (assignment) return assignment;

  const teachers = scopedTeachers(user, state);
  for (const teacher of teachers) {
    const assignments = Array.isArray(teacher.assignments) ? (teacher.assignments as Record<string, unknown>[]) : [];
    const linked = assignments.some((entry) => matchesClassSubject(entry, className, subject));
    const mainSubjectMatch =
      normalize(String(teacher.mainSubject ?? "")) === normalize(subject) &&
      assignments.some((entry) => normalize(String(entry.className ?? "")) === normalize(className));

    if (linked || mainSubjectMatch) {
      return {
        teacherId: teacher.id,
        teacherName: getTeacherDisplayName(teacher),
        className,
        name: subject,
        subject,
      };
    }
  }

  return undefined;
}

export function resolveCourseTeacher(
  state: BackOfficeState,
  user: SessionUser | null,
  className: string,
  subject: string,
): ResolvedCourseTeacher {
  const assignment = findCourseAssignment(state, user, className, subject);
  const teachers = scopedTeachers(user, state);

  let teacherId = String(assignment?.teacherId ?? "");
  let teacherName = String(assignment?.teacherName ?? "").trim();

  if (!teacherId && teacherName) {
    const teacher = findTeacherByName(teachers, teacherName);
    teacherId = String(teacher?.id ?? "");
    if (teacher) teacherName = getTeacherDisplayName(teacher);
  }
  if (teacherId && !teacherName) {
    teacherName = teacherDisplayName(teachers.find((row) => String(row.id) === teacherId) as Record<string, unknown>);
  }

  const fromCourse = Boolean(assignment && (teacherId || (teacherName && teacherName !== "Non assigné")));

  return {
    teacherId,
    teacherName: teacherName || "Non assigné",
    fromCourse,
  };
}

export function slotsToClassCalendarEvents(
  slots: CourseScheduleSlot[],
  className: string,
): PlanningCalendarEvent[] {
  return filterSlotsByClass(slots, className).map((slot) => {
    const subject = slot.subject.trim();
    const color = colorForKey(subject);
    const teacher = slot.teacherName || "Non assigné";
    const room = slot.room ? ` · ${slot.room}` : "";

    return {
      id: slot.id,
      title: `${subject} — ${teacher}${room}`,
      start: slot.start,
      end: slot.end,
      extendedProps: { ...slot, subject },
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

