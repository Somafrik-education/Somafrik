/**
 * Dates civiles de la fiche élève.
 *
 * Formats reconnus, ordre explicite jour/mois/année :
 * - YYYY-MM-DD
 * - DD-MM-YYYY
 * - horodatage ISO 8601 complet, validé (pas un préfixe `T` arbitraire) :
 *   `YYYY-MM-DDTHH:mm[:ss[.fraction]][Z|±HH:mm[:ss]]`
 *   secondes `00`–`59` (pas de seconde intercalaire) ;
 *   décalage civil `−12:00` à `+14:00` (rejet de `±23:00`).
 *
 * Une date civile n'est jamais déduite via `new Date(texte_non_ISO)`.
 * Les dates invalides restent invalides : aucun débordement silencieux.
 *
 * La validité calendaire n'utilise pas `Date.UTC(year, …)` : pour 0001–0099
 * ce constructeur mappe l'année vers 19xx. On utilise le calendrier grégorien
 * et `setUTCFullYear` / `setFullYear`.
 */

export type CivilDate = {
  year: number;
  month: number;
  day: number;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const CIVIL_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const CIVIL_DMY = /^(\d{2})-(\d{2})-(\d{4})$/;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isGregorianLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

function isCalendarDate(parts: CivilDate): boolean {
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day)
  ) {
    return false;
  }
  if (parts.year < 1 || parts.year > 9999) {
    return false;
  }
  if (parts.month < 1 || parts.month > 12) {
    return false;
  }
  if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
    return false;
  }
  return true;
}

const MAX_NEGATIVE_OFFSET_HOURS = 12;
const MAX_POSITIVE_OFFSET_HOURS = 14;

function isValidIsoClock(
  hour: number,
  minute: number,
  second: number | null,
  offsetSign: string | undefined,
  offsetHour: number | null,
  offsetMinute: number | null,
  offsetSecond: number | null,
): boolean {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return false;
  }
  if (second != null && (second < 0 || second > 59)) {
    return false;
  }
  if (!offsetSign) {
    return true;
  }
  if (
    offsetHour == null ||
    offsetHour < 0 ||
    offsetMinute == null ||
    offsetMinute < 0 ||
    offsetMinute > 59
  ) {
    return false;
  }
  if (offsetSecond != null && (offsetSecond < 0 || offsetSecond > 59)) {
    return false;
  }
  const maxHours =
    offsetSign === "-"
      ? MAX_NEGATIVE_OFFSET_HOURS
      : MAX_POSITIVE_OFFSET_HOURS;
  if (offsetHour > maxHours) {
    return false;
  }
  if (
    offsetHour === maxHours &&
    (offsetMinute !== 0 || (offsetSecond != null && offsetSecond !== 0))
  ) {
    return false;
  }
  return true;
}

function partsFromMatch(
  year: string,
  month: string,
  day: string,
): CivilDate | null {
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
  return isCalendarDate(parts) ? parts : null;
}

/** Parse déterministe vers {jour, mois, année}. Null si format ou calendrier invalide. */
export function parseCivilDateParts(
  value: string | null | undefined,
): CivilDate | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const iso = CIVIL_ISO.exec(normalized);
  if (iso) {
    return partsFromMatch(iso[1], iso[2], iso[3]);
  }

  const timestamp = ISO_TIMESTAMP.exec(normalized);
  if (timestamp) {
    const second = timestamp[6] == null ? null : Number(timestamp[6]);
    const offsetSign = timestamp[8];
    const offsetHour = timestamp[9] == null ? null : Number(timestamp[9]);
    const offsetMinute = timestamp[10] == null ? null : Number(timestamp[10]);
    const offsetSecond = timestamp[11] == null ? null : Number(timestamp[11]);
    if (
      !isValidIsoClock(
        Number(timestamp[4]),
        Number(timestamp[5]),
        second,
        offsetSign,
        offsetHour,
        offsetMinute,
        offsetSecond,
      )
    ) {
      return null;
    }
    return partsFromMatch(timestamp[1], timestamp[2], timestamp[3]);
  }

  const dmy = CIVIL_DMY.exec(normalized);
  if (dmy) {
    return partsFromMatch(dmy[3], dmy[2], dmy[1]);
  }

  return null;
}

/** Représentation canonique API / PostgreSQL : YYYY-MM-DD. */
export function toCanonicalCivilDate(
  value: string | null | undefined,
): string | null {
  const parts = parseCivilDateParts(value);
  if (!parts) {
    return null;
  }
  return `${String(parts.year).padStart(4, "0")}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Minuit local civil. `setFullYear` évite le mapping 0001–0099 → 19xx. */
function civilDateToLocalDate(parts: CivilDate): Date {
  const date = new Date(0);
  date.setFullYear(parts.year, parts.month - 1, parts.day);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Minuit UTC civil. `setUTCFullYear` évite le mapping 0001–0099 → 19xx. */
function civilDateToUtcDate(parts: CivilDate): Date {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Date locale à minuit civil, sans interpréter la chaîne via le parseur JS.
 * Conservée pour les consommateurs existants (âge, ordre d'inscription, documents).
 */
export function parseCivilDate(value: string): Date | null {
  const parts = parseCivilDateParts(value);
  return parts ? civilDateToLocalDate(parts) : null;
}

export function formatCivilDateLabel(
  value: string | null | undefined,
  fallback = "Non renseigné",
  locale = "fr-FR",
): string {
  if (!value?.trim()) {
    return fallback;
  }

  const parts = parseCivilDateParts(value);
  if (!parts) {
    return value.trim();
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(civilDateToUtcDate(parts));
}

export function computeAgeFromCivilDate(
  value: string | null | undefined,
  referenceDate: Date = new Date(),
): number | null {
  const parts = parseCivilDateParts(value);
  if (!parts) {
    return null;
  }

  let age = referenceDate.getFullYear() - parts.year;
  const monthDelta = referenceDate.getMonth() + 1 - parts.month;
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && referenceDate.getDate() < parts.day)
  ) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

export function formatAgeLabel(
  value: string | null | undefined,
  fallback = "Non renseigné",
  referenceDate: Date = new Date(),
): string {
  const age = computeAgeFromCivilDate(value, referenceDate);
  if (age === null) {
    return fallback;
  }
  return `${age} an${age > 1 ? "s" : ""}`;
}
