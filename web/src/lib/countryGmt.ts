/** Décalages GMT proposés pour la fiche pays (stockage : GMT±N). */
export const COUNTRY_GMT_OPTIONS = [
  { value: "GMT-1", label: "GMT-1" },
  { value: "GMT+0", label: "GMT+0" },
  { value: "GMT+1", label: "GMT+1" },
  { value: "GMT+2", label: "GMT+2" },
  { value: "GMT+3", label: "GMT+3" },
] as const;

const IANA_TO_GMT: Record<string, string> = {
  "Africa/Kinshasa": "GMT+1",
  "Africa/Brazzaville": "GMT+1",
  "Africa/Lagos": "GMT+1",
  "Africa/Douala": "GMT+1",
  "Africa/Libreville": "GMT+1",
  "Africa/Bujumbura": "GMT+2",
  "Africa/Kigali": "GMT+2",
  "Africa/Dakar": "GMT+0",
  "Africa/Abidjan": "GMT+0",
  "Africa/Bamako": "GMT+0",
  "Africa/Ouagadougou": "GMT+0",
  "Africa/Conakry": "GMT+0",
  "Africa/Lome": "GMT+0",
  "Africa/Porto-Novo": "GMT+0",
  UTC: "GMT+0",
};

/** Normalise une valeur héritée (IANA) vers GMT±N pour affichage et édition. */
export function normalizeCountryGmt(value?: string, fallback = "GMT+1"): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (/^GMT[+-]\d{1,2}$/i.test(raw)) {
    const sign = raw.includes("-") ? "-" : "+";
    const hours = raw.match(/\d{1,2}/)?.[0] ?? "0";
    return `GMT${sign}${hours}`;
  }
  return IANA_TO_GMT[raw] ?? raw;
}

export function formatCountryGmt(value?: string): string {
  return normalizeCountryGmt(value);
}
