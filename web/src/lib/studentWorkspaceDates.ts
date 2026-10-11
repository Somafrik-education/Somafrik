/**
 * Dates civiles de la fiche élève.
 *
 * Formats reconnus, ordre explicite jour/mois/année :
 * - YYYY-MM-DD (éventuellement préfixe ISO `T…`)
 * - DD-MM-YYYY
 *
 * Une date civile n'est jamais déduite via `new Date(texte_non_ISO)`.
 * Les dates invalides restent invalides : aucun débordement silencieux.
 */

export type CivilDate = {
  year: number;
  month: number;
  day: number;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

function isCalendarDate(parts: CivilDate): boolean {
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day)
  ) {
    return false;
  }
  if (
    parts.year < 1 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31
  ) {
    return false;
  }
  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    candidate.getUTCFullYear() === parts.year &&
    candidate.getUTCMonth() === parts.month - 1 &&
    candidate.getUTCDate() === parts.day
  );
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

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(normalized);
  if (iso) {
    const parts = {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
    };
    return isCalendarDate(parts) ? parts : null;
  }

  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(normalized);
  if (dmy) {
    const parts = {
      year: Number(dmy[3]),
      month: Number(dmy[2]),
      day: Number(dmy[1]),
    };
    return isCalendarDate(parts) ? parts : null;
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

function civilDateToLocalDate(parts: CivilDate): Date {
  return new Date(parts.year, parts.month - 1, parts.day);
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
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
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
