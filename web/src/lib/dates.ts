/**
 * Dates métier BackOffice : stockage et affichage en JJ-MM-AAAA.
 * Champs HTML `<input type="date">` : YYYY-MM-DD (conversion via periodDateToInput / inputToPeriodDate).
 * Horodatages techniques (audit, createdAt) : ISO 8601.
 */
export {
  inputToPeriodDate,
  parsePeriodDate,
  periodDateToInput,
} from "./academicPeriods";

import { parsePeriodDate } from "./academicPeriods";

export const PERIOD_DATE_HINT = "JJ-MM-AAAA";

export function formatPeriodDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function todayPeriodDate(now = new Date()): string {
  return formatPeriodDate(now);
}

/** Normalise toute date reconnue vers JJ-MM-AAAA. */
export function normalizePeriodDate(value?: string): string {
  const parsed = parsePeriodDate(value);
  if (!parsed) return String(value ?? "").trim();
  return formatPeriodDate(parsed);
}

function startOfCalendarDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function isPeriodDateBefore(value?: string, reference = new Date()): boolean {
  const parsed = parsePeriodDate(value);
  if (!parsed) return false;
  return startOfCalendarDay(parsed).getTime() < startOfCalendarDay(reference).getTime();
}

export function daysLateFromPeriodDate(dueDate?: string, now = new Date()): number {
  const due = parsePeriodDate(dueDate);
  if (!due) return 0;
  const diff = startOfCalendarDay(now).getTime() - startOfCalendarDay(due).getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}
