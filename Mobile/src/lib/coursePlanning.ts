import type { CourseScheduleSlot } from "../data/catalog";
import { normalize } from "./format";

/**
 * Consultation mobile du planning par créneau (jour/heure) synchronisé depuis
 * le back-office web. On y reproduit une version légère de la détection de
 * chevauchement enseignant / classe pour afficher une alerte, sans dupliquer
 * tout le moteur d'occurrences (le web reste la source d'édition).
 */

export const PLANNING_WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

export function isExamSlot(slot: CourseScheduleSlot): boolean {
  return String(slot.kind ?? "") === "exam";
}

export function weekdayOf(slot: CourseScheduleSlot): number {
  const date = new Date(slot.start);
  return Number.isNaN(date.getTime()) ? -1 : date.getDay();
}

export function weekdayLabel(value: number): string {
  return PLANNING_WEEKDAYS.find((row) => row.value === value)?.label ?? "—";
}

export function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function slotTimeRange(slot: CourseScheduleSlot): string {
  return `${timeLabel(slot.start)}–${timeLabel(slot.end)}`;
}

function minutesOfDay(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return -1;
  return date.getHours() * 60 + date.getMinutes();
}

/** Filtre les créneaux d'une école (et optionnellement d'un ensemble de classes). */
export function scopeSlots(
  slots: CourseScheduleSlot[],
  options: { schoolCode?: string; classNames?: Set<string> } = {},
): CourseScheduleSlot[] {
  const { schoolCode, classNames } = options;
  return slots.filter((slot) => {
    if (schoolCode && schoolCode !== "*" && normalize(slot.schoolCode) !== normalize(schoolCode)) {
      return false;
    }
    if (classNames && classNames.size && !classNames.has(normalize(slot.className))) {
      return false;
    }
    return true;
  });
}

export type PlanningDayGroup = {
  weekday: number;
  label: string;
  slots: CourseScheduleSlot[];
};

/** Regroupe les créneaux par jour de semaine, triés par heure de début. */
export function groupSlotsByDay(slots: CourseScheduleSlot[]): PlanningDayGroup[] {
  const groups: PlanningDayGroup[] = PLANNING_WEEKDAYS.map((day) => ({
    weekday: day.value,
    label: day.label,
    slots: [],
  }));
  const byWeekday = new Map(groups.map((group) => [group.weekday, group]));

  for (const slot of slots) {
    const group = byWeekday.get(weekdayOf(slot));
    if (group) group.slots.push(slot);
  }

  for (const group of groups) {
    group.slots.sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
  }

  return groups.filter((group) => group.slots.length > 0);
}

function periodDatesOverlap(a: CourseScheduleSlot, b: CourseScheduleSlot): boolean {
  const parse = (value?: string): number | null => {
    const m = String(value ?? "").match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return null;
    return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  };
  const aStart = parse(a.periodStart);
  const aEnd = parse(a.periodEnd);
  const bStart = parse(b.periodStart);
  const bEnd = parse(b.periodEnd);
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return true;
  return aStart <= bEnd && aEnd >= bStart;
}

function slotsOverlap(a: CourseScheduleSlot, b: CourseScheduleSlot): boolean {
  if (normalize(a.schoolCode) !== normalize(b.schoolCode)) return false;
  const aStart = minutesOfDay(a.start);
  const aEnd = minutesOfDay(a.end);
  const bStart = minutesOfDay(b.start);
  const bEnd = minutesOfDay(b.end);
  if (aStart < 0 || aEnd < 0 || bStart < 0 || bEnd < 0) return false;
  if (weekdayOf(a) !== weekdayOf(b)) return false;
  if (!isExamSlot(a) && !isExamSlot(b) && !periodDatesOverlap(a, b)) return false;
  return aStart < bEnd && aEnd > bStart;
}

export type PlanningConflict = {
  slotId: string;
  message: string;
};

/** Détecte les chevauchements enseignant / classe pour une bannière d'alerte. */
export function detectConflicts(slots: CourseScheduleSlot[]): PlanningConflict[] {
  const conflicts: PlanningConflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i];
      const b = slots[j];
      if (!slotsOverlap(a, b)) continue;

      if (a.teacherId && b.teacherId && String(a.teacherId) === String(b.teacherId)) {
        const key = `T|${[a.id, b.id].sort().join("|")}`;
        if (!seen.has(key)) {
          seen.add(key);
          const teacher = a.teacherName || b.teacherName || "Enseignant";
          conflicts.push({
            slotId: a.id,
            message: `${teacher} : « ${a.subject} » (${a.className}) et « ${b.subject} » (${b.className}) ${weekdayLabel(weekdayOf(a))} ${slotTimeRange(a)}.`,
          });
        }
      }

      if (normalize(a.className) && normalize(a.className) === normalize(b.className)) {
        const key = `C|${[a.id, b.id].sort().join("|")}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            slotId: a.id,
            message: `${a.className} : « ${a.subject} » et « ${b.subject} » se chevauchent ${weekdayLabel(weekdayOf(a))} ${slotTimeRange(a)}.`,
          });
        }
      }
    }
  }

  return conflicts;
}
