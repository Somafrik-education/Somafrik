export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isPastDate(value?: string): boolean {
  if (!value) return false;
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  let date: Date;
  if (ddmmyyyy) {
    date = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return false;
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
  const normalized = String(countryScope ?? "").trim().toUpperCase();
  return COUNTRY_CODES[normalized] ?? (/^[A-Z]{2}$/.test(normalized) ? normalized : "");
}

export function countryScopeMatches(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  if (normalize(left) === normalize(right)) return true;
  const leftCode = getCountryCodeFromScope(left);
  const rightCode = getCountryCodeFromScope(right);
  return Boolean(leftCode && rightCode && leftCode === rightCode);
}

export function schoolMatchesCountryScope(
  school: { country?: string; countryCode?: string; code?: string },
  countryScope?: string,
): boolean {
  if (!countryScope) return true;
  if (countryScopeMatches(school.country, countryScope)) return true;
  if (countryScopeMatches(school.countryCode, countryScope)) return true;
  const scopeCode = getCountryCodeFromScope(countryScope);
  if (scopeCode && normalize(school.countryCode) === normalize(scopeCode)) return true;
  if (scopeCode && String(school.code ?? "").toUpperCase().startsWith(scopeCode)) return true;
  return false;
}

export function isInternalSchoolRole(role?: string): boolean {
  const key = normalize(role);
  return [
    "admin school",
    "administrateur ecole",
    "administrateur etablissement",
    "secretaire",
    "prefet des etudes",
    "prefet des etude",
    "proviseur / directeur",
    "proviseur",
    "directeur",
    "directeur adjoint",
    "comptable",
    "accountant",
    "school_admin",
    "principal",
    "proviseur",
    "prefet",
    "secretary",
    "adjoint",
    "supervisor",
  ].includes(key);
}

export function isSchoolAdminRole(role?: string): boolean {
  const key = normalize(role);
  return ["admin school", "administrateur ecole", "administrateur etablissement", "school_admin"].includes(key);
}

export function displayRoleName(role?: string): string {
  return role ?? "Utilisateur";
}
