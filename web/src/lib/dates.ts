/**
 * Contrat dates Somafrik.
 *
 * - UI : JJ-MM-AAAA
 * - API / PostgreSQL : YYYY-MM-DD pour une date civile, ISO 8601 pour un horodatage
 * - Une date civile n'est jamais passée par un parse UTC implicite afin d'éviter un décalage de jour.
 */
export {
  inputToPeriodDate,
  parsePeriodDate,
  periodDateToInput,
} from "./academicPeriods";

import { parsePeriodDate } from "./academicPeriods";

export const DISPLAY_DATE_HINT = "JJ-MM-AAAA";
export const PERIOD_DATE_HINT = DISPLAY_DATE_HINT;

type DateParts = { year: number; month: number; day: number };

const pad = (value: number) => String(value).padStart(2, "0");

function isCalendarDate({ year, month, day }: DateParts): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function parseIsoParts(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isCalendarDate(parts) ? parts : null;
}

function parseDisplayParts(value: string): DateParts | null {
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const parts = { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
  return isCalendarDate(parts) ? parts : null;
}

function partsToDisplay(parts: DateParts): string {
  return `${pad(parts.day)}-${pad(parts.month)}-${String(parts.year).padStart(4, "0")}`;
}

function partsToApi(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatPeriodDate(date: Date): string {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function todayPeriodDate(now = new Date()): string {
  return formatPeriodDate(now);
}

/** Affichage canonique d'une date utilisateur. Les chaînes ISO date-only restent des dates civiles. */
export function formatDateForDisplay(value?: string | Date | null): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return formatPeriodDate(value);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parts = parseIsoParts(raw) ?? parseDisplayParts(raw);
  return parts ? partsToDisplay(parts) : "";
}

/** Validation stricte du format UI JJ-MM-AAAA, y compris années bissextiles. */
export function isValidDisplayDate(value?: string | null): boolean {
  return Boolean(parseDisplayParts(String(value ?? "").trim()));
}

/** JJ-MM-AAAA -> YYYY-MM-DD. Retourne une chaîne vide si la date est invalide. */
export function parseDisplayDate(value?: string | null): string {
  const parts = parseDisplayParts(String(value ?? "").trim());
  return parts ? partsToApi(parts) : "";
}

/** Accepte une date UI ou ISO et renvoie la date civile canonique API. */
export function toApiDate(value?: string | Date | null): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parts = parseDisplayParts(raw) ?? parseIsoParts(raw);
  return parts ? partsToApi(parts) : "";
}

/** Alias explicite à la frontière API -> UI. */
export function fromApiDate(value?: string | null): string {
  return formatDateForDisplay(value);
}

/**
 * Affiche un horodatage avec le même contrat de date. Pour une chaîne ISO, on conserve
 * le jour et l'heure présents dans le payload plutôt que de convertir implicitement le fuseau.
 */
export function formatDateTimeForDisplay(value?: string | Date | null): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${formatPeriodDate(value)} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return formatDateForDisplay(raw);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!isCalendarDate(parts)) return "";
  return `${partsToDisplay(parts)} ${match[4]}:${match[5]}`;
}

/** Normalise toute date reconnue vers JJ-MM-AAAA (compatibilité périodes existantes). */
export function normalizePeriodDate(value?: string): string {
  const direct = formatDateForDisplay(value);
  if (direct) return direct;
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
