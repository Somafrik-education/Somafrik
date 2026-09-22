/**
 * Contrat dates Somafrik Mobile.
 * UI = JJ-MM-AAAA ; API = YYYY-MM-DD pour les dates civiles.
 * Les dates civiles ne sont jamais parsées comme UTC afin d'éviter un décalage de jour.
 */
export const DISPLAY_DATE_HINT = "JJ-MM-AAAA";
export const PERIOD_DATE_HINT = DISPLAY_DATE_HINT;

type DateParts = { year: number; month: number; day: number };
const pad = (value: number) => String(value).padStart(2, "0");

function isCalendarDate({ year, month, day }: DateParts): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
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

export function formatDateForDisplay(value?: string | Date | null): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${pad(value.getDate())}-${pad(value.getMonth() + 1)}-${value.getFullYear()}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parts = parseIsoParts(raw) ?? parseDisplayParts(raw);
  return parts ? partsToDisplay(parts) : "";
}

export function isValidDisplayDate(value?: string | null): boolean {
  return Boolean(parseDisplayParts(String(value ?? "").trim()));
}

export function parseDisplayDate(value?: string | null): string {
  const parts = parseDisplayParts(String(value ?? "").trim());
  return parts ? partsToApi(parts) : "";
}

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

export function fromApiDate(value?: string | null): string {
  return formatDateForDisplay(value);
}

export function formatDateTimeForDisplay(value?: string | Date | null): string {
  const raw = value instanceof Date ? value : String(value ?? "").trim();
  if (raw === "") return "";
  if (typeof raw === "string" && !/[T ]\d{2}:\d{2}/.test(raw)) return formatDateForDisplay(raw);
  const parsed = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${formatDateForDisplay(parsed)} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}
