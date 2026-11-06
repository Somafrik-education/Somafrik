/**
 * PLANNING-MOBILE-CALENDAR — navigation civile locale sans UTC implicite.
 * Les créneaux sont des récurrences hebdomadaires canoniques : aucune copie
 * de l'ancien catalogue de créneaux datés.
 */
export type NativePlanningView = "day" | "week" | "month";
export const NATIVE_PLANNING_VIEWS: NativePlanningView[] = ["day", "week", "month"];
const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export function civilDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function atLocalMidnight(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
export function addCivilDays(value: Date, count: number): Date {
  const date = atLocalMidnight(value);
  date.setDate(date.getDate() + count);
  return date;
}
export function mondayOf(value: Date): Date {
  const weekday = (value.getDay() + 6) % 7;
  return addCivilDays(value, -weekday);
}
export function planningVisibleDays(view: NativePlanningView, anchor: Date): Date[] {
  const start = view === "day" ? atLocalMidnight(anchor)
    : view === "week" ? mondayOf(anchor)
    : mondayOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const length = view === "day" ? 1 : view === "week" ? 7 : 42;
  return Array.from({ length }, (_, index) => addCivilDays(start, index));
}
export function shiftPlanningAnchor(view: NativePlanningView, anchor: Date, delta: number): Date {
  if (view === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
  return addCivilDays(anchor, delta * (view === "week" ? 7 : 1));
}
export function planningDayLabel(date: Date): string {
  return `${DAYS[date.getDay()]} ${date.getDate()}`;
}
export function planningPeriodLabel(view: NativePlanningView, anchor: Date): string {
  if (view === "month") return anchor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  if (view === "day") return anchor.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const week = planningVisibleDays("week", anchor);
  return `${week[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${week[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
}
export function canonicalWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}
export function countByWeekday<T extends { dayOfWeek: number }>(slots: readonly T[], day: Date): number {
  const weekday = canonicalWeekday(day);
  return slots.filter((slot) => slot.dayOfWeek === weekday).length;
}
