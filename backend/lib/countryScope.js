function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const COUNTRY_CODES = {
  RDC: "CD",
  "REPUBLIQUE DEMOCRATIQUE DU CONGO": "CD",
  BURUNDI: "BI",
  BI: "BI",
  CONGO: "CG",
  CG: "CG",
  SENEGAL: "SN",
  SN: "SN",
};

function getCountryCodeFromScope(countryScope) {
  const normalized = String(countryScope ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  if (!normalized) return "";
  if (COUNTRY_CODES[normalized]) return COUNTRY_CODES[normalized];
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
}

function countryScopeMatches(left, right) {
  if (!left || !right) return false;
  if (normalize(left) === normalize(right)) return true;
  const leftCode = getCountryCodeFromScope(left);
  const rightCode = getCountryCodeFromScope(right);
  return Boolean(leftCode && rightCode && leftCode === rightCode);
}

function schoolMatchesCountryScope(school, countryScope) {
  if (!countryScope) return false;
  if (countryScopeMatches(school?.country, countryScope)) return true;
  if (countryScopeMatches(school?.countryCode, countryScope)) return true;
  const scopeCode = getCountryCodeFromScope(countryScope);
  if (scopeCode && normalize(school?.countryCode) === normalize(scopeCode)) return true;
  if (scopeCode && String(school?.code ?? "").toUpperCase().startsWith(scopeCode)) return true;
  return false;
}

module.exports = {
  getCountryCodeFromScope,
  countryScopeMatches,
  schoolMatchesCountryScope,
};
