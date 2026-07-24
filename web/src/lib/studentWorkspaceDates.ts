/**
 * Parse une date civile YYYY-MM-DD sans décalage de fuseau.
 * Les timestamps ISO complets restent gérés via Date native.
 */
export function parseCivilDate(value: string): Date | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const civilMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (civilMatch) {
    const year = Number(civilMatch[1]);
    const month = Number(civilMatch[2]);
    const day = Number(civilMatch[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export function formatCivilDateLabel(
  value: string | null | undefined,
  fallback = "Non renseigné",
  locale = "fr-FR",
): string {
  if (!value?.trim()) {
    return fallback;
  }

  const date = parseCivilDate(value);
  if (!date) {
    return value.trim();
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function computeAgeFromCivilDate(
  value: string | null | undefined,
  referenceDate: Date = new Date(),
): number | null {
  if (!value?.trim()) {
    return null;
  }

  const birthDate = parseCivilDate(value);
  if (!birthDate) {
    return null;
  }

  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const monthDelta = referenceDate.getMonth() - birthDate.getMonth();
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && referenceDate.getDate() < birthDate.getDate())
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
