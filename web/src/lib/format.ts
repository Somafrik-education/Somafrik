import { parsePeriodDate } from "./dates";

export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function formatMetric(value: number, suffix?: string): string {
  const formatted = new Intl.NumberFormat("fr-FR").format(Number(value ?? 0));
  return suffix ? `${formatted} ${suffix}` : formatted;
}

export function getInitials(firstName?: string, lastName?: string): string {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "·";
}

export function displayRoleName(role?: string): string {
  return role ?? "Utilisateur";
}

export function isPastDate(value?: string): boolean {
  if (!value) return false;
  const date = parsePeriodDate(value);
  if (!date) return false;
  return date.getTime() < Date.now();
}

export function isActiveUserAccount(user: { status?: string }): boolean {
  return normalize(user.status) !== "suspendu";
}

const COUNTRY_CODES: Record<string, string> = {
  RDC: "CD",
  "REPUBLIQUE DEMOCRATIQUE DU CONGO": "CD",
  BURUNDI: "BI",
  BI: "BI",
  CONGO: "CG",
  CG: "CG",
  SENEGAL: "SN",
  SN: "SN",
};

export function getCountryCodeFromScope(countryScope?: string): string {
  const normalized = String(countryScope ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  if (!normalized) return "";
  if (COUNTRY_CODES[normalized]) return COUNTRY_CODES[normalized];
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
}

/** Valeur canonique de countryScope pour un compte utilisateur (ex. RDC, BI, CG). */
export function canonicalCountryScope(country: { name: string; code: string }): string {
  const name = normalize(country.name);
  if (name.includes("democratique du congo") || country.code === "CD") return "RDC";
  if (country.code === "BI" || name === "burundi") return "BI";
  return country.code;
}

export function countryScopeMatches(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  if (normalize(left) === normalize(right)) return true;
  const leftCode = getCountryCodeFromScope(left);
  const rightCode = getCountryCodeFromScope(right);
  return Boolean(leftCode && rightCode && leftCode === rightCode);
}

export function resolveCountryScopeFromSchool(
  school: { country?: string; countryCode?: string },
  fallback = "",
): string {
  const code =
    getCountryCodeFromScope(school.countryCode) || getCountryCodeFromScope(school.country);
  if (code === "CD") return "RDC";
  if (code) return code;
  return fallback;
}

export function schoolMatchesCountryScope(
  school: { country?: string; countryCode?: string; code?: string },
  countryScope?: string,
): boolean {
  if (!countryScope) return false;
  if (countryScopeMatches(school.country, countryScope)) return true;
  if (countryScopeMatches(school.countryCode, countryScope)) return true;
  const scopeCode = getCountryCodeFromScope(countryScope);
  if (scopeCode && normalize(school.countryCode) === normalize(scopeCode)) return true;
  if (scopeCode && String(school.code ?? "").toUpperCase().startsWith(scopeCode)) return true;
  return false;
}

export function normalizeRoleKey(role?: string): string {
  return normalize(role);
}

export function isInternalSchoolRole(role?: string): boolean {
  const key = normalizeRoleKey(role);
  return [
    "admin school",
    "administrateur ecole",
    "administrateur etablissement",
    "school_admin",
    "secretaire",
    "secretary",
    "prefet des etudes",
    "prefet des etude",
    "prefet",
    "proviseur / directeur",
    "proviseur",
    "directeur",
    "directeur adjoint",
    "comptable",
    "principal",
    "enseignant",
    "teacher",
    "surveillant",
  ].includes(key);
}

export function isSchoolAdminRole(role?: string): boolean {
  const key = normalizeRoleKey(role);
  return ["admin school", "administrateur ecole", "administrateur etablissement"].includes(key);
}

export type EstablishmentChartProfile = "default" | "academic" | "finance" | "operations";

export function getEstablishmentChartProfile(role?: string): EstablishmentChartProfile {
  const key = normalizeRoleKey(role);
  if (
    ["prefet des etudes", "prefet", "proviseur", "directeur", "principal", "enseignant", "teacher"].includes(key)
  ) {
    return "academic";
  }
  if (key === "comptable") return "finance";
  if (["secretaire", "secretary", "surveillant"].includes(key)) return "operations";
  return "default";
}
