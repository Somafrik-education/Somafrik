import type { BackOfficeState, SessionUser } from "../types";
import { getSubjectsForClass, DEFAULT_SUBJECTS } from "./academicConfig";
import {
  coercePeriodMode,
  normalizeStoredPeriods,
  parsePeriodDate,
  type AcademicPeriodRow,
} from "./academicPeriods";
import { normalize } from "./format";
import { findTeacherByName, getTeacherDisplayName } from "./pedagogySync";
import { scopedAssignments, scopedClasses, scopedCourses, scopedTeachers } from "./establishment";
import { fixUtf8Mojibake, needsPlanningTextRepair, planningLabelsMatch, resolveCanonicalLabel } from "./planningTextRepair";
import { addDays, endOfDay, startOfDay } from "date-fns";

export type PlanningScheduleKind = "course" | "exam";
export type PlanningViewFilter = "all" | PlanningScheduleKind;

export const EXAM_TYPE_OPTIONS = ["Contrôle", "Devoir", "Examen", "Interrogation"] as const;

export const EXAM_PLANNING_COLOR = "#c2410c";

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
  /** Cours récurrent ou session d'examen ponctuelle. */
  kind?: PlanningScheduleKind;
  /** Intitulé affiché pour un examen planifié. */
  examName?: string;
  examType?: string;
  examId?: string;
  periodName?: string;
  periodStart?: string;
  periodEnd?: string;
  /** DTO canonique Planning V2 — projection, jamais autorité locale. */
  schoolCourseId?: string;
  academicYearId?: string;
  classId?: string;
  subjectId?: string;
  /** 1 = lundi … 7 = dimanche. */
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  status?: string;
  courseName?: string;
  roomId?: string;
  originalTeacher?: string;
  originalTeacherId?: string;
  replacement?: boolean;
  replacementId?: string;
  occurrenceDate?: string;
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

/** Couleur fixe par matière (stable dans tout l'établissement). */
const SUBJECT_COLOR_MAP: Record<string, string> = {
  mathematiques: "#2563eb",
  francais: "#dc2626",
  sciences: "#16a34a",
  histoire: "#b45309",
  geographie: "#ca8a04",
  anglais: "#7c3aed",
  physique: "#0891b2",
  chimie: "#db2777",
  svt: "#059669",
  informatique: "#4f46e5",
  eps: "#ea580c",
  philosophie: "#6366f1",
  economie: "#0d9488",
  comptabilite: "#be185d",
  dessin: "#9333ea",
  musique: "#c026d3",
  religion: "#64748b",
  langue: "#0284c7",
};

const FALLBACK_SUBJECT_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#ea580c",
  "#0d9488",
  "#4f46e5",
  "#b45309",
  "#059669",
  "#be185d",
];

export function getCourseColor(subject: string): string {
  const key = normalize(subject);
  if (!key) return FALLBACK_SUBJECT_COLORS[0];
  if (SUBJECT_COLOR_MAP[key]) return SUBJECT_COLOR_MAP[key];

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash + key.charCodeAt(i) * (i + 1)) % FALLBACK_SUBJECT_COLORS.length;
  }
  return FALLBACK_SUBJECT_COLORS[hash] ?? FALLBACK_SUBJECT_COLORS[0];
}

export function buildSubjectColorLegend(subjects: Iterable<string>): { subject: string; color: string }[] {
  const seen = new Set<string>();
  const legend: { subject: string; color: string }[] = [];
  for (const raw of subjects) {
    const subject = String(raw ?? "").trim();
    if (!subject) continue;
    const key = normalize(subject);
    if (seen.has(key)) continue;
    seen.add(key);
    legend.push({ subject, color: getCourseColor(subject) });
  }
  return legend.sort((a, b) => a.subject.localeCompare(b.subject, "fr"));
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

export function normalizeScheduleKind(kind?: string): PlanningScheduleKind {
  return kind === "exam" ? "exam" : "course";
}

export function isExamSchedule(slot: CourseScheduleSlot): boolean {
  return normalizeScheduleKind(slot.kind) === "exam";
}

export function isCourseSchedule(slot: CourseScheduleSlot): boolean {
  return !isExamSchedule(slot);
}

export function filterSlotsByKind(
  slots: CourseScheduleSlot[],
  filter: PlanningViewFilter,
): CourseScheduleSlot[] {
  if (filter === "all") return slots;
  return slots.filter((slot) => normalizeScheduleKind(slot.kind) === filter);
}

export function getScheduleColor(slot: CourseScheduleSlot): string {
  if (isExamSchedule(slot)) return EXAM_PLANNING_COLOR;
  return getCourseColor(slot.subject);
}

export function isoToPeriodDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function buildExamSlotTimes(
  examDate: string,
  startTime: string,
  endTime: string,
): { start: string; end: string } {
  const day = parsePeriodDate(examDate);
  if (!day) return { start: "", end: "" };

  const [startHour, startMinute] = startTime.split(":").map((part) => Number(part));
  const [endHour, endMinute] = endTime.split(":").map((part) => Number(part));

  const start = new Date(day);
  start.setHours(startHour || 0, startMinute || 0, 0, 0);

  const end = new Date(day);
  end.setHours(endHour || 0, endMinute || 0, 0, 0);
  if (end <= start) {
    end.setTime(start.getTime() + 2 * 60 * 60 * 1000);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

export function examRecordId(slot: CourseScheduleSlot): string {
  return slot.examId || `EX-${getMasterScheduleId(slot.id)}`;
}

export function slotToExamRecord(
  slot: CourseScheduleSlot,
  prior?: Record<string, unknown>,
): Record<string, unknown> {
  const examId = examRecordId(slot);
  const examType = slot.examType?.trim() || "Examen";
  return {
    id: examId,
    schoolCode: slot.schoolCode,
    name: slot.examName?.trim() || `${examType} — ${slot.subject}`,
    className: slot.className,
    subject: slot.subject,
    examType,
    date: isoToPeriodDate(slot.start),
    period: slot.periodName?.trim() || "",
    status: String(prior?.status ?? "Programmé"),
  };
}

export function mergePlanningLinkedExams(
  state: BackOfficeState,
  nextSchoolSlots: CourseScheduleSlot[],
  previousSchoolSlots: CourseScheduleSlot[],
): unknown[] {
  const prevExamIds = new Set(
    previousSchoolSlots
      .filter(isExamSchedule)
      .map((slot) => examRecordId(slot)),
  );
  const priorById = new Map(
    (state.exams ?? []).map((row) => [String((row as Record<string, unknown>).id ?? ""), row as Record<string, unknown>]),
  );
  const nextExamRecords = nextSchoolSlots
    .filter(isExamSchedule)
    .map((slot) => slotToExamRecord(slot, priorById.get(examRecordId(slot))));
  const nextExamIds = new Set(nextExamRecords.map((row) => String(row.id)));
  const removedIds = [...prevExamIds].filter((id) => !nextExamIds.has(id));

  const others = (state.exams ?? []).filter((row) => {
    const rowRecord = row as Record<string, unknown>;
    const id = String(rowRecord.id ?? "");
    if (removedIds.includes(id)) return false;
    if (nextExamIds.has(id)) return false;
    return true;
  });

  return [...others, ...nextExamRecords];
}

export function courseRecordKey(className: string, subject: string): string {
  return `${normalize(className)}|${normalize(subject)}`;
}

function courseRecordLookupKey(row: {
  className?: unknown;
  name?: unknown;
  subject?: unknown;
}): string {
  return `${normalize(String(row.className ?? ""))}|${normalize(String(row.name ?? row.subject ?? ""))}`;
}

export function slotToCourseRecord(
  slot: CourseScheduleSlot,
  prior?: Record<string, unknown>,
): Record<string, unknown> {
  const masterId = getMasterScheduleId(slot.id);
  return {
    id: String(prior?.id ?? `CO-${masterId}`),
    schoolCode: slot.schoolCode,
    name: slot.subject,
    className: slot.className,
    teacherId: slot.teacherId ?? "",
    teacherName: slot.teacherName ?? "",
  };
}

/** Synchronise le catalogue matières depuis les créneaux cours planifiés. */
export function mergePlanningLinkedCourses(
  state: BackOfficeState,
  nextSchoolSlots: CourseScheduleSlot[],
  previousSchoolSlots: CourseScheduleSlot[],
  schoolCode: string,
): unknown[] {
  const prevCourseKeys = new Set(
    previousSchoolSlots
      .filter(isCourseSchedule)
      .map((slot) => courseRecordLookupKey(slot)),
  );
  const priorByKey = new Map(
    (state.courses ?? []).map((row) => [
      courseRecordLookupKey(row as Record<string, unknown>),
      row as Record<string, unknown>,
    ]),
  );

  const nextByKey = new Map<string, Record<string, unknown>>();
  for (const slot of nextSchoolSlots.filter(isCourseSchedule)) {
    const key = courseRecordLookupKey(slot);
    nextByKey.set(key, slotToCourseRecord(slot, priorByKey.get(key)));
  }

  const nextKeys = new Set(nextByKey.keys());
  const removedKeys = [...prevCourseKeys].filter((key) => !nextKeys.has(key));

  const others = (state.courses ?? []).filter((row) => {
    const record = row as Record<string, unknown>;
    const rowSchool = normalize(String(record.schoolCode ?? ""));
    if (schoolCode && rowSchool && rowSchool !== normalize(schoolCode)) return true;
    const key = courseRecordLookupKey(record);
    if (nextKeys.has(key)) return false;
    if (removedKeys.includes(key)) return false;
    return true;
  });

  return [...others, ...nextByKey.values()];
}

/** Retire les affectations legacy d'un établissement (remplacées par le planning). */
export function clearSchoolAssignments(
  state: BackOfficeState,
  schoolCode: string,
): unknown[] {
  return ((state.assignments ?? []) as Record<string, unknown>[]).filter(
    (row) => normalize(String(row.schoolCode ?? "")) !== normalize(schoolCode),
  );
}

/** Retire les examens planifiés d'un établissement. */
export function clearSchoolPlanningExams(
  state: BackOfficeState,
  schoolCode: string,
): unknown[] {
  return ((state.exams ?? []) as Record<string, unknown>[]).filter(
    (row) => normalize(String(row.schoolCode ?? "")) !== normalize(schoolCode),
  );
}

/** Patch pour repartir d'un calendrier vierge (établissement courant). */
export function buildSchoolPlanningResetPatch(
  state: BackOfficeState,
  schoolCode: string,
): Pick<BackOfficeState, "courseSchedules" | "assignments" | "exams"> {
  const others = ((state.courseSchedules ?? []) as CourseScheduleSlot[]).filter(
    (row) => normalize(row.schoolCode) !== normalize(schoolCode),
  );
  return {
    courseSchedules: others,
    assignments: clearSchoolAssignments(state, schoolCode),
    exams: clearSchoolPlanningExams(state, schoolCode),
  };
}

/** Vide tout le planning plateforme (tous établissements). */
export function buildFullPlanningResetPatch(): Pick<
  BackOfficeState,
  "courseSchedules" | "assignments" | "exams"
> {
  return {
    courseSchedules: [],
    assignments: [],
    exams: [],
  };
}

export function scopedCourseSchedules(user: SessionUser | null, state: BackOfficeState): CourseScheduleSlot[] {
  const schoolCode = user?.schoolCode;
  const rows = (state.courseSchedules ?? []) as CourseScheduleSlot[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

const OCCURRENCE_ID_SUFFIX = "__";

export function getMasterScheduleId(eventId: string): string {
  const marker = eventId.indexOf(OCCURRENCE_ID_SUFFIX);
  return marker >= 0 ? eventId.slice(0, marker) : eventId;
}

export function getOccurrenceDateFromEventId(eventId: string): string {
  const marker = eventId.indexOf(OCCURRENCE_ID_SUFFIX);
  if (marker < 0) return "";
  return eventId.slice(marker + OCCURRENCE_ID_SUFFIX.length).slice(0, 10);
}

export function hasSchedulePeriod(slot: CourseScheduleSlot): boolean {
  if (isExamSchedule(slot)) return false;
  return Boolean(String(slot.periodStart ?? "").trim() && String(slot.periodEnd ?? "").trim());
}

export function getSchoolAcademicPeriods(
  state: BackOfficeState,
  schoolCode?: string,
): AcademicPeriodRow[] {
  const config = (state.academicConfigs?.[schoolCode ?? ""] ?? {}) as Record<string, unknown>;
  return normalizeStoredPeriods(config.periods, coercePeriodMode(config.periodMode));
}

export function getDefaultPlanningPeriod(
  state: BackOfficeState,
  schoolCode?: string,
): Pick<CourseScheduleSlot, "periodName" | "periodStart" | "periodEnd"> {
  const periods = getSchoolAcademicPeriods(state, schoolCode);
  const active = periods.find((row) => row.active) ?? periods[0];
  if (!active) {
    const now = new Date();
    const schoolYearStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return {
      periodName: "Année scolaire",
      periodStart: `01-09-${schoolYearStart}`,
      periodEnd: `30-06-${schoolYearStart + 1}`,
    };
  }
  return {
    periodName: active.name,
    periodStart: active.startDate,
    periodEnd: active.endDate,
  };
}

export function filterSlotsByPeriod(
  slots: CourseScheduleSlot[],
  period?: Pick<AcademicPeriodRow, "name" | "startDate" | "endDate"> | null,
): CourseScheduleSlot[] {
  if (!period?.name) return slots;

  const periodStart = parsePeriodDate(period.startDate);
  const periodEnd = parsePeriodDate(period.endDate);

  return slots.filter((slot) => {
    if (hasSchedulePeriod(slot)) {
      if (normalize(slot.periodName ?? "") === normalize(period.name)) return true;
      if (periodStart && periodEnd) {
        const slotStart = parsePeriodDate(slot.periodStart);
        const slotEnd = parsePeriodDate(slot.periodEnd);
        if (slotStart && slotEnd) {
          return slotStart <= endOfDay(periodEnd) && endOfDay(slotEnd) >= startOfDay(periodStart);
        }
      }
      return false;
    }

    if (periodStart && periodEnd) {
      const slotStart = new Date(slot.start);
      if (!Number.isNaN(slotStart.getTime())) {
        return slotStart >= startOfDay(periodStart) && slotStart <= endOfDay(periodEnd);
      }
    }

    return true;
  });
}

/** Choisit la période contenant le plus de créneaux pour l'établissement. */
export function pickPlanningPeriodWithSlots(
  periods: AcademicPeriodRow[],
  slots: CourseScheduleSlot[],
  schoolCode?: string,
): AcademicPeriodRow | null {
  if (!periods.length) return null;

  const scoped = schoolCode
    ? slots.filter((slot) => normalize(slot.schoolCode ?? "") === normalize(schoolCode))
    : slots;

  let best = periods.find((row) => row.active) ?? periods[0];
  let bestCount = -1;

  for (const period of periods) {
    const count = filterSlotsByPeriod(scoped, period).length;
    if (count > bestCount) {
      bestCount = count;
      best = period;
    }
  }

  return bestCount > 0 ? best : periods.find((row) => row.active) ?? periods[0] ?? null;
}

export const ALL_PLANNING_PERIODS = "__all__";

export function expandScheduleOccurrences(
  slot: CourseScheduleSlot,
  bounds?: { viewStart?: Date; viewEnd?: Date },
): Array<{ id: string; start: string; end: string }> {
  if (isExamSchedule(slot)) {
    return [{ id: slot.id, start: slot.start, end: slot.end }];
  }

  const dayOfWeek = Number(slot.dayOfWeek);
  const startTime = String(slot.startTime ?? "").trim();
  const endTime = String(slot.endTime ?? "").trim();
  if (dayOfWeek >= 1 && dayOfWeek <= 7 && startTime && endTime) {
    const periodStart = parsePeriodDate(slot.periodStart) ?? bounds?.viewStart ?? null;
    const periodEnd = parsePeriodDate(slot.periodEnd) ?? bounds?.viewEnd ?? null;
    if (!periodStart || !periodEnd) {
      return slot.start && slot.end ? [{ id: slot.id, start: slot.start, end: slot.end }] : [];
    }
    const [startHour, startMinute] = startTime.split(":").map((part) => Number(part));
    const [endHour, endMinute] = endTime.split(":").map((part) => Number(part));
    const isoWeekdayOf = (date: Date) => {
      const js = date.getDay();
      return js === 0 ? 7 : js;
    };
    const occurrences: Array<{ id: string; start: string; end: string }> = [];
    let cursor = startOfDay(periodStart);
    const lastDay = endOfDay(periodEnd);
    while (cursor <= lastDay) {
      if (isoWeekdayOf(cursor) === dayOfWeek) {
        const occStart = new Date(cursor);
        occStart.setHours(startHour || 0, startMinute || 0, 0, 0);
        const occEnd = new Date(cursor);
        occEnd.setHours(endHour || 0, endMinute || 0, 0, 0);
        const overlapsView =
          !bounds?.viewStart ||
          !bounds?.viewEnd ||
          (occEnd >= bounds.viewStart && occStart <= bounds.viewEnd);
        if (overlapsView) {
          occurrences.push({
            id: `${slot.id}${OCCURRENCE_ID_SUFFIX}${occStart.toISOString().slice(0, 10)}`,
            start: occStart.toISOString(),
            end: occEnd.toISOString(),
          });
        }
      }
      cursor = addDays(cursor, 1);
    }
    return occurrences;
  }

  if (slot.start && slot.end) {
    return [{ id: slot.id, start: slot.start, end: slot.end }];
  }
  return [];
}

export function formatPeriodLabel(slot: Pick<CourseScheduleSlot, "periodName" | "periodStart" | "periodEnd">): string {
  if (slot.periodName?.trim()) {
    if (slot.periodStart && slot.periodEnd) {
      return `${slot.periodName} (${slot.periodStart} → ${slot.periodEnd})`;
    }
    return slot.periodName;
  }
  if (slot.periodStart && slot.periodEnd) {
    return `${slot.periodStart} → ${slot.periodEnd}`;
  }
  return "";
}

export const PLANNING_WEEKDAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 7, label: "Dimanche" },
] as const;

export function weekdayLabelFromDate(date: Date): string {
  const iso = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const weekday = PLANNING_WEEKDAYS.find((row) => row.value === iso);
  return weekday?.label ?? "";
}

/** Jour métier 1–7 depuis une date locale de calendrier. Dimanche = 7, jamais 0. */
export function isoWeekdayFromLocalDate(date: Date): number {
  const js = date.getDay();
  return js === 0 ? 7 : js;
}

export function extractTimeFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "08:00";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function weekdayFromIso(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 1;
  const js = date.getUTCDay();
  return js === 0 ? 7 : js;
}

export function slotIsoWeekday(slot: CourseScheduleSlot): number {
  const day = Number(slot.dayOfWeek);
  if (day >= 1 && day <= 7) return day;
  return weekdayFromIso(slot.start);
}

export function slotStartHm(slot: CourseScheduleSlot): string {
  const time = String(slot.startTime ?? "").trim();
  return time ? time.slice(0, 5) : extractTimeFromIso(slot.start);
}

export function slotEndHm(slot: CourseScheduleSlot): string {
  const time = String(slot.endTime ?? "").trim();
  return time ? time.slice(0, 5) : extractTimeFromIso(slot.end);
}

/** Construit un ancrage visuel. Le jour métier est 1–7 (7 = dimanche), pas Date.getDay(). */
export function buildSlotTemplateTimes(
  weekday: number,
  startTime: string,
  endTime: string,
  periodStart?: string,
): { start: string; end: string } {
  const isoWeekday = weekday === 0 ? 7 : weekday;
  const jsWeekday = isoWeekday === 7 ? 0 : isoWeekday;
  const anchor = parsePeriodDate(periodStart) ?? new Date();
  let cursor = startOfDay(anchor);
  cursor = addDays(cursor, (jsWeekday - cursor.getDay() + 7) % 7);

  const [startHour, startMinute] = startTime.split(":").map((part) => Number(part));
  const [endHour, endMinute] = endTime.split(":").map((part) => Number(part));

  const start = new Date(cursor);
  start.setHours(startHour || 0, startMinute || 0, 0, 0);

  const end = new Date(cursor);
  end.setHours(endHour || 0, endMinute || 0, 0, 0);
  if (end <= start) {
    end.setTime(start.getTime() + 60 * 60 * 1000);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

export function formatScheduleRecurrenceSummary(slot: CourseScheduleSlot): string {
  if (isExamSchedule(slot)) return formatExamScheduleSummary(slot);

  const weekdayValue = slotIsoWeekday(slot);
  const weekday = PLANNING_WEEKDAYS.find((row) => row.value === weekdayValue)?.label ?? "";
  const startTime = slotStartHm(slot);
  const endTime = slotEndHm(slot);
  const course = String(slot.courseName ?? slot.subject ?? "").trim();
  const parts = [course, weekday ? `chaque ${weekday.toLowerCase()}` : "", `${startTime}–${endTime}`];
  return parts.filter(Boolean).join(" · ");
}

export function formatExamScheduleSummary(slot: CourseScheduleSlot): string {
  const examType = slot.examType?.trim() || "Examen";
  const title = slot.examName?.trim() || slot.subject;
  const startTime = extractTimeFromIso(slot.start);
  const endTime = extractTimeFromIso(slot.end);
  const date = isoToPeriodDate(slot.start);
  return `${examType} · ${title} · ${date} · ${startTime}–${endTime}`;
}

export function getClassSubjectNames(
  user: SessionUser | null,
  state: BackOfficeState,
  className: string,
  schoolCode?: string,
): string[] {
  if (!className.trim()) return [];

  const classCandidates = collectPlanningClassCandidates(state, user, schoolCode);
  const canonicalClass = resolveCanonicalLabel(className, classCandidates);

  const fromSlots = scopedCourseSchedules(user, state)
    .filter((slot) => planningLabelsMatch(slot.className, canonicalClass))
    .map((slot) => resolveCanonicalLabel(slot.subject, collectPlanningSubjectCandidates(state, user, canonicalClass, schoolCode)))
    .filter(Boolean);

  const fromCourses = scopedCourses(user, state)
    .filter((row) => planningLabelsMatch(String(row.className ?? ""), canonicalClass))
    .map((row) => String(row.name ?? row.subject ?? "").trim())
    .filter(Boolean);

  const fromConfig = getSubjectsForClass(state, schoolCode, canonicalClass);

  const merged = uniqueSortedSubjects([...fromSlots, ...fromCourses, ...fromConfig]);
  if (merged.length) return merged;

  return [...DEFAULT_SUBJECTS];
}

export function filterSlotsByClass(slots: CourseScheduleSlot[], className: string): CourseScheduleSlot[] {
  if (!className.trim()) return [];
  return slots.filter((slot) => planningLabelsMatch(slot.className, className));
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
  row: { className?: unknown; name?: unknown; subject?: unknown; course?: unknown },
  className: string,
  subject: string,
): boolean {
  const rowClass = String(row.className ?? "");
  const rowSubject = String(row.name ?? row.subject ?? row.course ?? "");
  return planningLabelsMatch(rowClass, className) && planningLabelsMatch(rowSubject, subject);
}

export function findPlanningSlotForSubject(
  state: BackOfficeState,
  user: SessionUser | null,
  className: string,
  subject: string,
): CourseScheduleSlot | undefined {
  if (!className.trim() || !subject.trim()) return undefined;
  return scopedCourseSchedules(user, state).find(
    (slot) => isCourseSchedule(slot) && matchesClassSubject(slot, className, subject),
  );
}

export function hasPlanningSlotForSubject(
  slots: CourseScheduleSlot[],
  className: string,
  subject: string,
): boolean {
  return slots.some(
    (slot) => isCourseSchedule(slot) && matchesClassSubject(slot, className, subject),
  );
}

export function findCourseAssignment(
  state: BackOfficeState,
  user: SessionUser | null,
  className: string,
  subject: string,
): Record<string, unknown> | undefined {
  if (!className.trim() || !subject.trim()) return undefined;

  const slot = findPlanningSlotForSubject(state, user, className, subject);
  if (slot?.teacherId || slot?.teacherName) {
    return {
      teacherId: slot.teacherId,
      teacherName: slot.teacherName,
      className: slot.className,
      name: slot.subject,
      subject: slot.subject,
    };
  }

  const course = scopedCourses(user, state).find((row) => matchesClassSubject(row, className, subject));
  if (course) return course;

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
  bounds?: { viewStart?: Date; viewEnd?: Date },
): PlanningCalendarEvent[] {
  const events: PlanningCalendarEvent[] = [];

  filterSlotsByClass(slots, className).forEach((slot) => {
    const subject = slot.subject.trim();
    const color = getScheduleColor(slot);

    expandScheduleOccurrences(slot, bounds).forEach((occurrence) => {
      events.push({
        id: occurrence.id,
        title: formatPlanningEventLabel(slot),
        start: occurrence.start,
        end: occurrence.end,
        extendedProps: { ...slot, subject },
        backgroundColor: color,
        borderColor: color,
      });
    });
  });

  return events;
}

function asOccurrenceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Mappe la projection serveur GET /course-schedules?from=&to= vers le calendrier.
 * Aucune expansion de récurrence : start/end ISO viennent du serveur.
 */
export function mapServerOccurrencesToCalendarEvents(
  items: unknown,
  className?: string,
): PlanningCalendarEvent[] {
  const rows = Array.isArray(items) ? items : [];
  const events: PlanningCalendarEvent[] = [];

  for (const row of rows) {
    const item = asOccurrenceRecord(row);
    if (!item) continue;
    const status = String(item.status ?? "active").trim().toLowerCase();
    if (status === "cancelled") continue;
    const start = String(item.start ?? "").trim();
    const end = String(item.end ?? "").trim();
    if (!start || !end) continue;

    const subject = String(item.courseName ?? item.subject ?? "").trim();
    const slot: CourseScheduleSlot = {
      id: String(item.scheduleId ?? getMasterScheduleId(String(item.id ?? ""))),
      schoolCode: String(item.schoolCode ?? ""),
      className: String(item.className ?? ""),
      subject,
      courseName: String(item.courseName ?? subject),
      teacherId: item.teacherId != null ? String(item.teacherId) : undefined,
      teacherName: item.teacherName != null ? String(item.teacherName) : undefined,
      start,
      end,
      room: item.room != null ? String(item.room) : undefined,
      roomId: item.roomId != null ? String(item.roomId) : undefined,
      originalTeacher: item.originalTeacher != null ? String(item.originalTeacher) : undefined,
      originalTeacherId: item.originalTeacherId != null ? String(item.originalTeacherId) : undefined,
      replacement: Boolean(item.replacement),
      replacementId: item.replacementId != null ? String(item.replacementId) : undefined,
      occurrenceDate: item.occurrenceDate != null ? String(item.occurrenceDate) : undefined,
      kind: "course",
      schoolCourseId: item.schoolCourseId != null ? String(item.schoolCourseId) : undefined,
      academicYearId: item.academicYearId != null ? String(item.academicYearId) : undefined,
      classId: item.classId != null ? String(item.classId) : undefined,
      subjectId: item.subjectId != null ? String(item.subjectId) : undefined,
      dayOfWeek: item.dayOfWeek != null ? Number(item.dayOfWeek) : undefined,
      startTime: item.startTime != null ? String(item.startTime).slice(0, 5) : undefined,
      endTime: item.endTime != null ? String(item.endTime).slice(0, 5) : undefined,
      status: String(item.status ?? "active"),
    };

    if (isExamSchedule(slot)) continue;
    if (className && !planningLabelsMatch(slot.className, className)) continue;

    const color = getScheduleColor(slot);
    events.push({
      id: String(item.id ?? `${slot.id}${OCCURRENCE_ID_SUFFIX}${String(item.occurrenceDate ?? "")}`),
      title: formatPlanningEventLabel(slot),
      start,
      end,
      extendedProps: { ...slot, subject },
      backgroundColor: color,
      borderColor: color,
    });
  }

  return events;
}

/** Nom court enseignant (nom de famille) pour les cartes compactes. */
export function formatPlanningTeacherShortName(teacherName?: string): string {
  const name = String(teacherName ?? "").trim();
  if (!name || normalize(name) === normalize("Non assigné")) return "Non assigné";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? name;
  return parts[parts.length - 1] ?? name;
}

/** Libellé compact carte planning : « Sciences - Mukendi » ou « Examen · Maths - Dupont ». */
export function formatPlanningEventLabel(slot: CourseScheduleSlot): string {
  if (isExamSchedule(slot)) {
    const type = slot.examType?.trim() || "Examen";
    const name = slot.examName?.trim() || slot.subject || "Examen";
    const teacher = formatPlanningTeacherShortName(slot.teacherName);
    return `${type} · ${name} - ${teacher}`;
  }
  return formatPlanningEventCompactLabel(slot.subject, slot.teacherName);
}

/** Libellé compact carte planning : « Sciences - Mukendi ». */
export function formatPlanningEventCompactLabel(subject?: string, teacherName?: string): string {
  const subj = String(subject ?? "").trim() || "Créneau";
  const teacher = formatPlanningTeacherShortName(teacherName);
  return `${subj} - ${teacher}`;
}

/** Seuil hauteur (px) en dessous duquel la carte passe en mode compact. */
export const PLANNING_EVENT_COMPACT_HEIGHT = 52;

export function formatSlotLabel(slot: CourseScheduleSlot): string {
  const teacher = slot.teacherName ? ` — ${slot.teacherName}` : "";
  if (isExamSchedule(slot)) {
    return `${formatExamScheduleSummary(slot)}${teacher}`;
  }
  if (hasSchedulePeriod(slot)) {
    return `${formatScheduleRecurrenceSummary(slot)}${teacher}`;
  }
  const period = formatPeriodLabel(slot);
  const periodSuffix = period ? ` · ${period}` : "";
  return `${slot.subject} (${slot.className})${teacher}${periodSuffix}`;
}

export function periodsDateRangeOverlap(
  startA?: string,
  endA?: string,
  startB?: string,
  endB?: string,
): boolean {
  const aStart = parsePeriodDate(startA);
  const aEnd = parsePeriodDate(endA);
  const bStart = parsePeriodDate(startB);
  const bEnd = parsePeriodDate(endB);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= endOfDay(bEnd) && endOfDay(aEnd) >= startOfDay(bStart);
}

/** Une matière ne peut être planifiée qu'une fois par classe et par période (cours récurrent). */
export function detectDuplicateCoursePlanning(
  slots: CourseScheduleSlot[],
  candidate: CourseScheduleSlot,
  ignoreId?: string,
): string | null {
  if (isExamSchedule(candidate) || !hasSchedulePeriod(candidate)) return null;

  const ignoreMaster = ignoreId ? getMasterScheduleId(ignoreId) : "";
  const classKey = normalize(candidate.className);
  const subjectKey = normalize(candidate.subject);
  const periodKey = normalize(candidate.periodName ?? "");

  for (const slot of slots) {
    if (ignoreMaster && getMasterScheduleId(slot.id) === ignoreMaster) continue;
    if (isExamSchedule(slot) || !hasSchedulePeriod(slot)) continue;
    if (normalize(slot.className) !== classKey) continue;
    if (normalize(slot.subject) !== subjectKey) continue;

    const samePeriodName = Boolean(periodKey && normalize(slot.periodName ?? "") === periodKey);
    const overlappingDates = periodsDateRangeOverlap(
      slot.periodStart,
      slot.periodEnd,
      candidate.periodStart,
      candidate.periodEnd,
    );

    if (samePeriodName || overlappingDates) {
      const periodLabel = candidate.periodName || `${candidate.periodStart} → ${candidate.periodEnd}`;
      return `Le cours « ${candidate.subject} » est déjà planifié pour ${candidate.className} (${periodLabel}). Modifiez le créneau existant.`;
    }
  }

  return null;
}

export function normalizePlanningSlotForSave(slot: CourseScheduleSlot): CourseScheduleSlot {
  if (isExamSchedule(slot)) {
    return {
      ...slot,
      kind: "exam",
      examType: slot.examType?.trim() || "Examen",
      examId: slot.examId || `EX-${getMasterScheduleId(slot.id)}`,
    };
  }

  return {
    ...slot,
    kind: "course",
    periodName: slot.periodName?.trim() || undefined,
    periodStart: slot.periodStart?.trim() || undefined,
    periodEnd: slot.periodEnd?.trim() || undefined,
  };
}

export interface PlanningConsistencyIssue {
  slotId: string;
  message: string;
}

function collectPlanningClassCandidates(
  state: BackOfficeState,
  user: SessionUser | null,
  schoolCode?: string,
): string[] {
  const fromClasses = scopedClasses(user, state)
    .filter((row) => !schoolCode || normalize(String(row.schoolCode ?? "")) === normalize(schoolCode))
    .map((row) => String(row.name ?? "").trim())
    .filter(Boolean);

  const fromSlots = (state.courseSchedules ?? [])
    .filter((row) => !schoolCode || normalize(String((row as CourseScheduleSlot).schoolCode ?? "")) === normalize(schoolCode))
    .map((row) => fixUtf8Mojibake(String((row as CourseScheduleSlot).className ?? "")))
    .filter(Boolean);

  return uniqueSortedSubjects([...fromClasses, ...fromSlots]);
}

function collectPlanningSubjectCandidates(
  state: BackOfficeState,
  user: SessionUser | null,
  className: string,
  schoolCode?: string,
): string[] {
  const fromConfig = getSubjectsForClass(state, schoolCode, className);
  const fromCourses = scopedCourses(user, state)
    .filter((row) => planningLabelsMatch(String(row.className ?? ""), className))
    .map((row) => String(row.name ?? row.subject ?? "").trim())
    .filter(Boolean);
  const fromSlots = scopedCourseSchedules(user, state)
    .filter((slot) => planningLabelsMatch(slot.className, className))
    .map((slot) => slot.subject.trim())
    .filter(Boolean);

  return uniqueSortedSubjects([...DEFAULT_SUBJECTS, ...fromConfig, ...fromCourses, ...fromSlots]);
}

interface PedagogyLink {
  className: string;
  subject: string;
  teacherId?: string;
  teacherName?: string;
}

function collectPedagogyLinksForSchool(
  state: BackOfficeState,
  user: SessionUser | null,
  schoolCode: string,
): PedagogyLink[] {
  const classCandidates = collectPlanningClassCandidates(state, user, schoolCode);
  const links: PedagogyLink[] = [];
  const seen = new Set<string>();

  const pushLink = (raw: Record<string, unknown>) => {
    const className = resolveCanonicalLabel(String(raw.className ?? ""), classCandidates);
    if (!className.trim()) return;
    const subjectCandidates = collectPlanningSubjectCandidates(state, user, className, schoolCode);
    const subject = resolveCanonicalLabel(
      String(raw.name ?? raw.subject ?? raw.course ?? ""),
      subjectCandidates,
    );
    if (!subject.trim()) return;
    const key = courseRecordKey(className, subject);
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      className,
      subject,
      teacherId: String(raw.teacherId ?? ""),
      teacherName: String(raw.teacherName ?? "").trim(),
    });
  };

  for (const row of scopedAssignments(user, state)) {
    pushLink(row);
  }
  for (const row of scopedCourses(user, state)) {
    pushLink(row);
  }
  for (const teacher of scopedTeachers(user, state)) {
    const teacherId = String(teacher.id ?? "");
    const teacherName = getTeacherDisplayName(teacher);
    const nested = Array.isArray(teacher.assignments) ? (teacher.assignments as Record<string, unknown>[]) : [];
    for (const entry of nested) {
      pushLink({
        ...entry,
        teacherId: teacherId || entry.teacherId,
        teacherName: teacherName || entry.teacherName,
      });
    }
  }

  return links;
}

const IMPORT_WEEKDAYS = [1, 2, 3, 4, 5];
const IMPORT_HOURS = [8, 10, 13, 15];

/** Crée des créneaux planning pour matières/affectations sans emploi du temps. */
export function importPedagogyLinksIntoPlanning(
  state: BackOfficeState,
  user: SessionUser | null,
  schoolCode: string,
  slots: CourseScheduleSlot[],
): { slots: CourseScheduleSlot[]; migratedFromPedagogy: number } {
  const links = collectPedagogyLinksForSchool(state, user, schoolCode);
  const defaultPeriod = getDefaultPlanningPeriod(state, schoolCode);
  const next = [...slots];
  let migratedFromPedagogy = 0;

  links.forEach((link, index) => {
    if (hasPlanningSlotForSubject(next, link.className, link.subject)) return;

    const weekday = IMPORT_WEEKDAYS[index % IMPORT_WEEKDAYS.length];
    const hour = IMPORT_HOURS[index % IMPORT_HOURS.length];
    const startTime = `${String(hour).padStart(2, "0")}:00`;
    const endTime = `${String(hour + 2).padStart(2, "0")}:00`;
    const times = buildSlotTemplateTimes(weekday, startTime, endTime, defaultPeriod.periodStart);

    next.push(
      normalizePlanningSlotForSave({
        id: createScheduleId(),
        schoolCode,
        className: link.className,
        subject: link.subject,
        teacherId: link.teacherId || undefined,
        teacherName: link.teacherName || undefined,
        start: times.start,
        end: times.end,
        kind: "course",
        periodName: defaultPeriod.periodName,
        periodStart: defaultPeriod.periodStart,
        periodEnd: defaultPeriod.periodEnd,
      }),
    );
    migratedFromPedagogy += 1;
  });

  return { slots: next, migratedFromPedagogy };
}

function subjectPeriodDedupeKey(slot: CourseScheduleSlot): string {
  return [
    normalize(slot.className),
    normalize(slot.subject),
    normalize(slot.periodName ?? ""),
    slot.periodStart ?? "",
    slot.periodEnd ?? "",
  ].join("|");
}

function slotHasScheduleConflict(
  slots: CourseScheduleSlot[],
  candidate: CourseScheduleSlot,
  ignoreId?: string,
): boolean {
  return detectScheduleConflicts(slots, candidate, ignoreId).length > 0;
}

function findConflictFreeCourseTime(
  slots: CourseScheduleSlot[],
  slot: CourseScheduleSlot,
  periodStart: string,
): { start: string; end: string } | null {
  for (const weekday of IMPORT_WEEKDAYS) {
    for (const hour of IMPORT_HOURS) {
      const startTime = `${String(hour).padStart(2, "0")}:00`;
      const endTime = `${String(Math.min(hour + 2, 22)).padStart(2, "0")}:00`;
      const times = buildSlotTemplateTimes(weekday, startTime, endTime, periodStart);
      const candidate = normalizePlanningSlotForSave({
        ...slot,
        start: times.start,
        end: times.end,
      });
      if (!slotHasScheduleConflict(slots, candidate, slot.id)) {
        return times;
      }
    }
  }
  return null;
}

function dedupeSlotsBySubjectPeriod(slots: CourseScheduleSlot[]): {
  slots: CourseScheduleSlot[];
  removed: number;
} {
  const exams = slots.filter(isExamSchedule);
  const courses = slots.filter(isCourseSchedule);
  const byKey = new Map<string, CourseScheduleSlot>();

  for (const slot of courses) {
    const key = subjectPeriodDedupeKey(slot);
    const previous = byKey.get(key);
    if (!previous || courseSlotRepairScore(slot) > courseSlotRepairScore(previous)) {
      byKey.set(key, slot);
    }
  }

  return {
    slots: [...byKey.values(), ...exams],
    removed: courses.length - byKey.size,
  };
}

function syncMissingTeachersFromCourses(
  state: BackOfficeState,
  user: SessionUser | null,
  slots: CourseScheduleSlot[],
): { slots: CourseScheduleSlot[]; teachersSynced: number } {
  let teachersSynced = 0;
  const next = slots.map((slot) => {
    if (!isCourseSchedule(slot) || (slot.teacherId && slot.teacherName)) return slot;
    const course = scopedCourses(user, state).find((row) =>
      matchesClassSubject(row, slot.className, slot.subject),
    );
    if (!course) return slot;
    const teacherId = String(course.teacherId ?? "");
    const teacherName = String(course.teacherName ?? "").trim();
    if (!teacherId && !teacherName) return slot;
    teachersSynced += 1;
    return normalizePlanningSlotForSave({
      ...slot,
      teacherId: slot.teacherId || teacherId || undefined,
      teacherName: slot.teacherName || teacherName || undefined,
    });
  });
  return { slots: next, teachersSynced };
}

function resolveAllScheduleConflicts(slots: CourseScheduleSlot[]): {
  slots: CourseScheduleSlot[];
  conflictsResolved: number;
} {
  const next = [...slots];
  let conflictsResolved = 0;
  const maxPasses = 4;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let movedThisPass = false;
    const courseIds = next
      .filter(isCourseSchedule)
      .sort((a, b) => courseSlotRepairScore(a) - courseSlotRepairScore(b))
      .map((slot) => slot.id);

    for (const slotId of courseIds) {
      const index = next.findIndex((row) => row.id === slotId);
      if (index < 0) continue;
      const current = next[index];
      if (!slotHasScheduleConflict(next, current, current.id)) continue;

      const periodStart = current.periodStart ?? "";
      const freeTimes = findConflictFreeCourseTime(next, current, periodStart);
      if (!freeTimes) continue;

      next[index] = normalizePlanningSlotForSave({
        ...current,
        start: freeTimes.start,
        end: freeTimes.end,
      });
      conflictsResolved += 1;
      movedThisPass = true;
    }

    if (!movedThisPass) break;
  }

  return { slots: next, conflictsResolved };
}

function linkOrphanExamsToSlots(
  state: BackOfficeState,
  schoolCode: string,
  slots: CourseScheduleSlot[],
): { slots: CourseScheduleSlot[]; examsLinked: number } {
  const linkedIds = new Set(slots.filter(isExamSchedule).map((slot) => examRecordId(slot)));
  const next = [...slots];
  let examsLinked = 0;

  for (const row of state.exams ?? []) {
    const record = row as Record<string, unknown>;
    const id = String(record.id ?? "");
    if (!id || normalize(String(record.schoolCode ?? "")) !== normalize(schoolCode)) continue;
    if (linkedIds.has(id)) continue;

    const status = String(record.status ?? "Programmé");
    const examDate = String(record.date ?? "");
    if (status !== "Programmé" || !examDate.trim()) continue;

    const className = String(record.className ?? "").trim();
    const subject = String(record.subject ?? "").trim();
    if (!className || !subject) continue;

    const times = buildExamSlotTimes(examDate, "10:00", "12:00");
    if (!times.start || !times.end) continue;

    const scheduleId = createScheduleId();
    next.push(
      normalizePlanningSlotForSave({
        id: scheduleId,
        schoolCode,
        className,
        subject,
        start: times.start,
        end: times.end,
        kind: "exam",
        examType: String(record.examType ?? "Examen"),
        examName: String(record.name ?? `${record.examType ?? "Examen"} — ${subject}`),
        examId: id,
        periodName: String(record.period ?? ""),
      }),
    );
    linkedIds.add(id);
    examsLinked += 1;
  }

  return { slots: next, examsLinked };
}

function dropInvalidPlanningSlots(slots: CourseScheduleSlot[]): {
  slots: CourseScheduleSlot[];
  removed: number;
} {
  const valid = slots.filter((slot) => slot.subject?.trim() && slot.className?.trim());
  return { slots: valid, removed: slots.length - valid.length };
}

function courseSlotDedupeKey(slot: CourseScheduleSlot): string {
  return [
    normalize(slot.schoolCode),
    normalize(slot.className),
    normalize(slot.subject),
    String(weekdayFromIso(slot.start)),
    extractTimeFromIso(slot.start),
    extractTimeFromIso(slot.end),
    normalize(slot.periodName ?? ""),
    slot.periodStart ?? "",
    slot.periodEnd ?? "",
  ].join("|");
}

function courseSlotRepairScore(slot: CourseScheduleSlot): number {
  let score = 0;
  if (hasSchedulePeriod(slot)) score += 4;
  if (!needsPlanningTextRepair(slot.className)) score += 2;
  if (!needsPlanningTextRepair(slot.subject)) score += 2;
  return score;
}

export interface PlanningRepairReport {
  slots: CourseScheduleSlot[];
  encodingFixes: number;
  periodsAdded: number;
  duplicatesRemoved: number;
  migratedFromPedagogy: number;
  subjectPeriodDuplicatesRemoved: number;
  conflictsResolved: number;
  teachersSynced: number;
  examsLinked: number;
  invalidRemoved: number;
}

/** Répare encodage, périodes manquantes et doublons legacy pour un établissement. */
export function repairSchoolCourseSchedules(
  state: BackOfficeState,
  user: SessionUser | null,
  schoolCode: string,
): PlanningRepairReport {
  const classCandidates = collectPlanningClassCandidates(state, user, schoolCode);
  const defaultPeriod = getDefaultPlanningPeriod(state, schoolCode);
  const scoped = scopedCourseSchedules(user, state).filter(
    (row) => normalize(row.schoolCode) === normalize(schoolCode),
  );

  let encodingFixes = 0;
  let periodsAdded = 0;

  const repaired = scoped.map((slot) => {
    let next = { ...slot };
    const fixedClass = resolveCanonicalLabel(slot.className, classCandidates);
    const subjectCandidates = collectPlanningSubjectCandidates(state, user, fixedClass, schoolCode);
    const fixedSubject = resolveCanonicalLabel(slot.subject, subjectCandidates);

    if (fixedClass !== slot.className || fixedSubject !== slot.subject) {
      encodingFixes += 1;
    }

    next.className = fixedClass;
    next.subject = fixedSubject;

    if (isCourseSchedule(next) && !hasSchedulePeriod(next)) {
      const weekday = weekdayFromIso(next.start);
      const times = buildSlotTemplateTimes(
        weekday,
        extractTimeFromIso(next.start),
        extractTimeFromIso(next.end),
        defaultPeriod.periodStart,
      );
      next = {
        ...next,
        periodName: defaultPeriod.periodName,
        periodStart: defaultPeriod.periodStart,
        periodEnd: defaultPeriod.periodEnd,
        start: times.start,
        end: times.end,
      };
      periodsAdded += 1;
    }

    return normalizePlanningSlotForSave(next);
  });

  const dedupedCourses = new Map<string, CourseScheduleSlot>();
  const exams: CourseScheduleSlot[] = [];

  for (const slot of repaired) {
    if (isExamSchedule(slot)) {
      exams.push(slot);
      continue;
    }
    const key = courseSlotDedupeKey(slot);
    const previous = dedupedCourses.get(key);
    if (!previous || courseSlotRepairScore(slot) > courseSlotRepairScore(previous)) {
      dedupedCourses.set(key, slot);
    }
  }

  const duplicatesRemoved = repaired.filter(isCourseSchedule).length - dedupedCourses.size;

  const subjectPeriodDeduped = dedupeSlotsBySubjectPeriod([
    ...dedupedCourses.values(),
    ...exams,
  ]);

  const withoutInvalid = dropInvalidPlanningSlots(subjectPeriodDeduped.slots);

  const teachersSynced = syncMissingTeachersFromCourses(state, user, withoutInvalid.slots);

  const conflictsResolved = resolveAllScheduleConflicts(teachersSynced.slots);

  const imported = importPedagogyLinksIntoPlanning(
    state,
    user,
    schoolCode,
    conflictsResolved.slots,
  );

  const relinked = linkOrphanExamsToSlots(state, schoolCode, imported.slots);

  const finalConflicts = resolveAllScheduleConflicts(relinked.slots);

  return {
    slots: finalConflicts.slots,
    encodingFixes,
    periodsAdded,
    duplicatesRemoved,
    migratedFromPedagogy: imported.migratedFromPedagogy,
    subjectPeriodDuplicatesRemoved: subjectPeriodDeduped.removed,
    conflictsResolved: conflictsResolved.conflictsResolved + finalConflicts.conflictsResolved,
    teachersSynced: teachersSynced.teachersSynced,
    examsLinked: relinked.examsLinked,
    invalidRemoved: withoutInvalid.removed,
  };
}

export function canRepairSchoolPlanning(
  state: BackOfficeState,
  user: SessionUser | null,
  schoolCode?: string,
): boolean {
  if (!schoolCode) return false;
  const scoped = scopedCourseSchedules(user, state).filter(
    (row) => normalize(row.schoolCode) === normalize(schoolCode),
  );
  return auditSchoolPlanningConsistency(scoped, state, user, schoolCode).length > 0;
}

/** Contrôle la cohérence des créneaux chargés (données seed / historiques). */
export function auditSchoolPlanningConsistency(
  slots: CourseScheduleSlot[],
  state: BackOfficeState,
  user: SessionUser | null,
  schoolCode?: string,
): PlanningConsistencyIssue[] {
  const scoped = schoolCode
    ? slots.filter((row) => normalize(row.schoolCode) === normalize(schoolCode))
    : slots;

  const classCandidates = collectPlanningClassCandidates(state, user, schoolCode);
  const issues: PlanningConsistencyIssue[] = [];
  const seenSubjectPeriod = new Map<string, string>();
  const noPeriodCounts = new Map<string, { slotId: string; count: number; message: string }>();

  for (const slot of scoped) {
    if (!slot.subject?.trim()) {
      issues.push({ slotId: slot.id, message: "Créneau sans cours." });
    }

    if (isCourseSchedule(slot) && !hasSchedulePeriod(slot)) {
      const weeklyDay = Number(slot.dayOfWeek);
      const weeklyStart = String(slot.startTime ?? "").trim();
      const isWeeklyRule = weeklyDay >= 1 && weeklyDay <= 7 && Boolean(weeklyStart);
      if (!isWeeklyRule) {
        const displaySubject = resolveCanonicalLabel(slot.subject, collectPlanningSubjectCandidates(
          state,
          user,
          resolveCanonicalLabel(slot.className, classCandidates),
          schoolCode,
        ));
        const displayClass = resolveCanonicalLabel(slot.className, classCandidates);
        const key = `${normalize(displayClass)}|${normalize(displaySubject)}`;
        const message = `Cours « ${displaySubject} » (${displayClass}) sans période — une seule occurrence affichée.`;
        const existing = noPeriodCounts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          noPeriodCounts.set(key, { slotId: slot.id, count: 1, message });
        }
      }
    }

    if (isCourseSchedule(slot) && hasSchedulePeriod(slot)) {
      const key = subjectPeriodDedupeKey(slot);
      const previousId = seenSubjectPeriod.get(key);
      if (previousId && previousId !== slot.id) {
        issues.push({
          slotId: slot.id,
          message: `Doublon : ${slot.subject} planifié deux fois pour ${slot.className} sur la même période.`,
        });
      } else {
        seenSubjectPeriod.set(key, slot.id);
      }
    }

    if (isCourseSchedule(slot)) {
      for (const message of detectScheduleConflicts(scoped, slot, slot.id)) {
        issues.push({ slotId: slot.id, message });
      }
    }
  }

  for (const entry of noPeriodCounts.values()) {
    issues.push({
      slotId: entry.slotId,
      message:
        entry.count > 1
          ? `${entry.message.replace(/\.$/, "")} (${entry.count} créneaux).`
          : entry.message,
    });
  }

  if (schoolCode) {
    const unplannedCounts = new Map<string, { slotId: string; count: number; message: string }>();
    for (const link of collectPedagogyLinksForSchool(state, user, schoolCode)) {
      if (hasPlanningSlotForSubject(scoped, link.className, link.subject)) continue;
      const key = courseRecordKey(link.className, link.subject);
      const message = `Cours « ${link.subject} » (${link.className}) sans créneau planning — absent du calendrier.`;
      const existing = unplannedCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        unplannedCounts.set(key, { slotId: `UNPLANNED-${key}`, count: 1, message });
      }
    }
    for (const entry of unplannedCounts.values()) {
      issues.push({
        slotId: entry.slotId,
        message:
          entry.count > 1
            ? `${entry.message.replace(/\.$/, "")} (${entry.count} sources).`
            : entry.message,
      });
    }
  }

  const linkedExamIds = new Set(
    scoped.filter(isExamSchedule).map((slot) => examRecordId(slot)),
  );
  for (const row of state.exams ?? []) {
    const record = row as Record<string, unknown>;
    const id = String(record.id ?? "");
    if (!id || !schoolCode || normalize(String(record.schoolCode ?? "")) !== normalize(schoolCode)) {
      continue;
    }
    if (linkedExamIds.has(id)) continue;
    const status = String(record.status ?? "Programmé");
    if (status === "Programmé" && record.date) {
      issues.push({
        slotId: id,
        message: `Examen « ${String(record.name ?? id)} » sans créneau calendrier — planifiez-le dans Planning de cours.`,
      });
    }
  }

  const seenMessages = new Set<string>();
  return issues.filter((issue) => {
    if (seenMessages.has(issue.message)) return false;
    seenMessages.add(issue.message);
    return true;
  });
}

/** Vérifie que le planning ne génère aucune alerte de cohérence. */
export function isPlanningFullyConsistent(
  state: BackOfficeState,
  user: SessionUser | null,
  schoolCode: string,
  slots: CourseScheduleSlot[],
): boolean {
  return auditSchoolPlanningConsistency(slots, state, user, schoolCode).length === 0;
}

export function validatePlanningSlotBusinessRules(
  slots: CourseScheduleSlot[],
  candidate: CourseScheduleSlot,
  options: { ignoreId?: string; allowedSubjects?: string[] } = {},
): string[] {
  const normalized = normalizePlanningSlotForSave(candidate);
  const issues = [...detectScheduleConflicts(slots, normalized, options.ignoreId)];

  const duplicate = detectDuplicateCoursePlanning(slots, normalized, options.ignoreId);
  if (duplicate) issues.push(duplicate);

  if (isCourseSchedule(normalized)) {
    const weeklyDay = Number(normalized.dayOfWeek);
    const weeklyStart = String(normalized.startTime ?? "").trim();
    const weeklyEnd = String(normalized.endTime ?? "").trim();
    const isWeeklyRule = weeklyDay >= 1 && weeklyDay <= 7 && Boolean(weeklyStart) && Boolean(weeklyEnd);
    if (!isWeeklyRule && !hasSchedulePeriod(normalized)) {
      issues.push("Un cours récurrent doit avoir un jour 1–7 et des heures, ou une période.");
    }
  }

  if (options.allowedSubjects?.length) {
    const allowed = options.allowedSubjects.some(
      (subject) => normalize(subject) === normalize(normalized.subject),
    );
    if (!allowed) {
      issues.push(
        `Le cours « ${normalized.subject} » n'est pas configuré pour la classe ${normalized.className}.`,
      );
    }
  }

  if (isExamSchedule(normalized)) {
    const examDay = parsePeriodDate(isoToPeriodDate(normalized.start));
    if (!examDay) {
      issues.push("Date d'examen invalide.");
    }
  }

  return [...new Set(issues)];
}

export function detectScheduleConflicts(
  slots: CourseScheduleSlot[],
  candidate: CourseScheduleSlot,
  ignoreId?: string,
): string[] {
  const candidateDay = Number(candidate.dayOfWeek);
  const candidateStart = String(candidate.startTime ?? "").trim();
  const candidateEnd = String(candidate.endTime ?? "").trim();
  if (candidateDay >= 1 && candidateDay <= 7 && candidateStart && candidateEnd) {
    if (candidateEnd <= candidateStart) {
      return ["L'heure de fin doit être postérieure à l'heure de début."];
    }
    const ignoreMaster = ignoreId ? getMasterScheduleId(ignoreId) : "";
    const issues: string[] = [];
    for (const slot of slots) {
      if (ignoreMaster && getMasterScheduleId(slot.id) === ignoreMaster) continue;
      if (normalize(slot.schoolCode) !== normalize(candidate.schoolCode)) continue;
      const slotDay = Number(slot.dayOfWeek);
      const slotStart = String(slot.startTime ?? "").trim();
      const slotEnd = String(slot.endTime ?? "").trim();
      if (!(slotDay >= 1 && slotDay <= 7 && slotStart && slotEnd)) continue;
      if (slotDay !== candidateDay) continue;
      const overlaps = candidateStart < slotEnd && candidateEnd > slotStart;
      if (!overlaps) continue;
      if (candidate.teacherId && slot.teacherId && candidate.teacherId === slot.teacherId) {
        const teacherLabel = slot.teacherName ? ` ${slot.teacherName}` : "";
        issues.push(
          `Conflit enseignant${teacherLabel} : déjà « ${slot.subject} » (${slot.className}) ${slotStart}–${slotEnd}.`,
        );
      }
      if (planningLabelsMatch(candidate.className, slot.className)) {
        issues.push(`Conflit sur ${slot.className} : « ${slot.subject} » ${slotStart}–${slotEnd}.`);
      }
    }
    return [...new Set(issues)];
  }
  const start = new Date(candidate.start).getTime();
  const end = new Date(candidate.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return ["L'heure de fin doit être postérieure à l'heure de début."];
  }

  const ignoreMaster = ignoreId ? getMasterScheduleId(ignoreId) : "";
  const candidateOccurrences = expandScheduleOccurrences(candidate).map((occurrence) => ({
    ...candidate,
    id: occurrence.id,
    start: occurrence.start,
    end: occurrence.end,
  }));

  const whenLabel = (occ: { start: string; end: string }) =>
    `${weekdayLabelFromDate(new Date(occ.start))} ${extractTimeFromIso(occ.start)}–${extractTimeFromIso(occ.end)}`.trim();

  const issues: string[] = [];

  for (const slot of slots) {
    if (ignoreMaster && getMasterScheduleId(slot.id) === ignoreMaster) continue;
    if (normalize(slot.schoolCode) !== normalize(candidate.schoolCode)) continue;

    const slotOccurrences = expandScheduleOccurrences(slot).map((occurrence) => ({
      ...slot,
      id: occurrence.id,
      start: occurrence.start,
      end: occurrence.end,
    }));

    for (const candidateOcc of candidateOccurrences) {
      const candidateStart = new Date(candidateOcc.start).getTime();
      const candidateEnd = new Date(candidateOcc.end).getTime();

      for (const slotOcc of slotOccurrences) {
        const slotStart = new Date(slotOcc.start).getTime();
        const slotEnd = new Date(slotOcc.end).getTime();
        const overlaps = candidateStart < slotEnd && candidateEnd > slotStart;
        if (!overlaps) continue;

        if (
          candidateOcc.teacherId &&
          slotOcc.teacherId &&
          candidateOcc.teacherId === slotOcc.teacherId
        ) {
          const teacherLabel = slotOcc.teacherName ? ` ${slotOcc.teacherName}` : "";
          issues.push(
            `Conflit enseignant${teacherLabel} : déjà « ${slotOcc.subject} » (${slotOcc.className}) ${whenLabel(slotOcc)}.`,
          );
        }
        if (planningLabelsMatch(candidateOcc.className, slotOcc.className)) {
          issues.push(`Conflit sur ${slotOcc.className} : « ${slotOcc.subject} » ${whenLabel(slotOcc)}.`);
        }
      }
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

