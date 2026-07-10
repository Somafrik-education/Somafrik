import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { fr } from "date-fns/locale";

export type PlanningCalendarView = "day" | "work_week" | "week" | "month";

export const PLANNING_HOUR_START = 7;
export const PLANNING_HOUR_END = 20;
export const PLANNING_SLOT_MINUTES = 30;
export const PLANNING_ROW_HEIGHT = 28;

export const VIEW_LABELS: Record<PlanningCalendarView, string> = {
  day: "Vue jour",
  work_week: "Vue semaine",
  week: "Planning avec heures",
  month: "Vue mois",
};

export const VIEW_ORDER: PlanningCalendarView[] = ["day", "work_week", "week", "month"];

/** Vue par défaut : semaine en cours (lun–ven), ou 7 jours le week-end pour inclure aujourd'hui. */
export function getDefaultPlanningCalendarView(date = new Date()): PlanningCalendarView {
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6 ? "week" : "work_week";
}

export function toValidDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function getViewDays(view: PlanningCalendarView, anchor: Date): Date[] {
  if (view === "day") return [startOfDay(anchor)];

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const count = view === "work_week" ? 5 : 7;
  return Array.from({ length: count }, (_, index) => addDays(weekStart, index));
}

export function getMonthGridDays(anchor: Date): Date[] {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

export function formatRangeLabel(view: PlanningCalendarView, date: Date): string {
  if (view === "month") {
    return format(date, "MMMM yyyy", { locale: fr });
  }
  if (view === "day") {
    return format(date, "EEEE d MMMM yyyy", { locale: fr });
  }
  const days = getViewDays(view, date);
  const start = days[0];
  const end = days[days.length - 1];
  return `${format(start, "d MMM", { locale: fr })} – ${format(end, "d MMM yyyy", { locale: fr })}`;
}

export function shiftAnchorDate(
  view: PlanningCalendarView,
  anchor: Date,
  action: "PREV" | "NEXT" | "TODAY",
): Date {
  if (action === "TODAY") return new Date();
  const next = new Date(anchor);
  if (view === "month") {
    next.setMonth(next.getMonth() + (action === "PREV" ? -1 : 1));
    return next;
  }
  if (view === "day") {
    next.setDate(next.getDate() + (action === "PREV" ? -1 : 1));
    return next;
  }
  next.setDate(next.getDate() + (action === "PREV" ? -7 : 7));
  return next;
}

export function formatDayHeader(date: Date): string {
  return format(date, "EEE d MMM", { locale: fr });
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function setMinutesFromMidnight(day: Date, minutes: number): Date {
  const next = startOfDay(day);
  next.setMinutes(minutes);
  return next;
}

export function snapMinutes(minutes: number, slotMinutes = PLANNING_SLOT_MINUTES): number {
  return Math.round(minutes / slotMinutes) * slotMinutes;
}

export function clampMinutes(minutes: number): number {
  const min = PLANNING_HOUR_START * 60;
  const max = PLANNING_HOUR_END * 60;
  return Math.min(max, Math.max(min, minutes));
}

export function slotCount(): number {
  return ((PLANNING_HOUR_END - PLANNING_HOUR_START) * 60) / PLANNING_SLOT_MINUTES;
}

export function eventBlockStyle(start: Date, end: Date): { top: number; height: number } {
  const startMin = clampMinutes(snapMinutes(minutesFromMidnight(start)));
  const endMin = clampMinutes(snapMinutes(minutesFromMidnight(end)));
  const duration = Math.max(PLANNING_SLOT_MINUTES, endMin - startMin);
  const top = ((startMin - PLANNING_HOUR_START * 60) / PLANNING_SLOT_MINUTES) * PLANNING_ROW_HEIGHT;
  const height = (duration / PLANNING_SLOT_MINUTES) * PLANNING_ROW_HEIGHT - 2;
  return { top, height };
}

export function pointerToSlot(
  clientY: number,
  gridTop: number,
  scrollTop: number,
): number {
  const relativeY = clientY - gridTop + scrollTop;
  const slotIndex = Math.floor(relativeY / PLANNING_ROW_HEIGHT);
  const minutes = PLANNING_HOUR_START * 60 + slotIndex * PLANNING_SLOT_MINUTES;
  return clampMinutes(snapMinutes(minutes));
}

export function pointerToDayIndex(clientX: number, columnRects: DOMRect[]): number {
  const index = columnRects.findIndex((rect) => clientX >= rect.left && clientX <= rect.right);
  return index >= 0 ? index : 0;
}

export function eventsForDay<T extends { start: Date; end: Date }>(events: T[], day: Date): T[] {
  return events.filter((event) => isSameDay(event.start, day) || isSameDay(event.end, day) || (event.start < day && event.end > day));
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function isCurrentMonth(date: Date, anchor: Date): boolean {
  return isSameMonth(date, anchor);
}

export function formatMonthDay(date: Date): string {
  return format(date, "d", { locale: fr });
}

export function formatEventTime(date: Date): string {
  return format(date, "HH:mm", { locale: fr });
}

export function formatEventTimeRange(start: Date, end: Date): string {
  return `${formatEventTime(start)} – ${formatEventTime(end)}`;
}
