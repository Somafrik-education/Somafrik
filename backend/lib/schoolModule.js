/** Utilitaires établissements — miroir web/src/lib/schoolModule.ts */
const { getCountryCodeFromScope } = require("./countryScope");

const SCHOOL_TYPES = [
  "École primaire",
  "Collège",
  "Lycée",
  "Université",
  "Institut",
  "Centre de formation",
];

const DUPLICATE_STRONG = "DUPLICATE_STRONG";
const DUPLICATE_CONTACT = "DUPLICATE_CONTACT";
const CROSS_COUNTRY_CONTACT_MATCH = "CROSS_COUNTRY_CONTACT_MATCH";

const GENERIC_EMAILS = new Set([
  "contact@somafrik.app",
  "info@somafrik.app",
  "hello@somafrik.app",
  "admin@somafrik.app",
]);

const GENERIC_PHONES = new Set(["9090909", "0000000", "1111111", "1234567", "0123456789"]);

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function generateSchoolCode(countryCode, schools = []) {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!code) return "";
  const year = new Date().getFullYear();
  const prefix = `${code}-${year}-`;
  const maxNum = schools.reduce((max, school) => {
    const value = String(school.code ?? "").trim().toUpperCase();
    if (!value.startsWith(prefix)) return max;
    const match = value.match(/-(\d{4})$/);
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
}

function isSchoolDeleted(school) {
  return (
    normalize(school.status) === "supprime" ||
    normalize(school.status) === "deleted" ||
    Boolean(school.deletedAt)
  );
}

function filterActiveSchools(schools = []) {
  return schools.filter((school) => !isSchoolDeleted(school));
}

function validateSchoolPayload(school, schools, { isNew = false } = {}) {
  const name = String(school.name ?? "").trim();
  if (name.length < 2) return "Le nom de l'établissement doit contenir au moins 2 caractères.";
  if (!String(school.type ?? "").trim()) return "Le type d'établissement est obligatoire.";
  if (!String(school.country ?? "").trim()) return "Le pays est obligatoire.";
  if (!String(school.city ?? "").trim()) return "La ville est obligatoire.";
  if (!String(school.phone ?? "").trim()) return "Le téléphone est obligatoire.";
  const email = String(school.email ?? "").trim();
  if (!email) return "L'email est obligatoire.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Format email invalide.";
  if (!String(school.principalName ?? "").trim()) return "Le responsable principal est obligatoire.";

  const code = String(school.code ?? "").trim().toUpperCase();
  if (!code) return "Le code établissement est obligatoire.";
  const duplicateCode = isNew
    ? schools.some((item) => normalize(item.code) === normalize(code))
    : schools.some((item) => normalize(item.code) === normalize(code) && item.code !== school.code);
  if (duplicateCode) return "Ce code établissement existe déjà.";

  return null;
}

function schoolIdentityKeys(school) {
  return [school?.code, school?.publicId, school?.loginCode, school?.login_code, school?.school_code]
    .map((value) => normalize(value))
    .filter(Boolean);
}

function schoolCountryIso(school) {
  return getCountryCodeFromScope(school?.countryCode || school?.country_code || school?.iso_code || school?.country);
}

function phoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function isGenericSchoolEmail(email) {
  const value = normalize(email);
  if (!value) return true;
  if (GENERIC_EMAILS.has(value)) return true;
  return /^(contact|info|hello|admin)@somafrik\./.test(value);
}

function isGenericSchoolPhone(phone) {
  const digits = phoneDigits(phone);
  if (!digits) return true;
  if (GENERIC_PHONES.has(digits)) return true;
  return digits.length <= 7 && /^(\d)\1+$/.test(digits);
}

/**
 * Classification pays-aware.
 * Ancien algorithme dangereux : email OR phone OR (name AND city), sans country_id.
 */
function classifySchoolDuplicates(school, schools = []) {
  const name = normalize(school?.name);
  const city = normalize(school?.city);
  const email = normalize(school?.email);
  const phone = phoneDigits(school?.phone);
  const identity = new Set(schoolIdentityKeys(school));
  const country = schoolCountryIso(school);
  const genericEmail = isGenericSchoolEmail(school?.email);
  const genericPhone = isGenericSchoolPhone(school?.phone);

  const matches = [];
  for (const item of schools) {
    if (identity.size && schoolIdentityKeys(item).some((key) => identity.has(key))) continue;
    const itemCountry = schoolCountryIso(item);
    const sameCountry = Boolean(country && itemCountry && country === itemCountry);
    const sameNameCity = Boolean(name && city && normalize(item.name) === name && normalize(item.city) === city);
    const sameEmail = Boolean(email && normalize(item.email) === email);
    const samePhone = Boolean(phone && phoneDigits(item.phone) === phone);
    const contactEmail = sameEmail && !genericEmail && !isGenericSchoolEmail(item.email);
    const contactPhone = samePhone && !genericPhone && !isGenericSchoolPhone(item.phone);

    if (sameCountry && sameNameCity) {
      matches.push({
        school: item,
        level: DUPLICATE_STRONG,
        reasons: ["Même nom et ville dans ce pays"],
      });
      continue;
    }
    if (sameCountry && (contactEmail || contactPhone)) {
      const reasons = [
        contactEmail ? "Même email dans ce pays" : "",
        contactPhone ? "Même téléphone dans ce pays" : "",
      ].filter(Boolean);
      matches.push({ school: item, level: DUPLICATE_CONTACT, reasons });
      continue;
    }
    if (!sameCountry && (contactEmail || contactPhone)) {
      const reasons = [
        contactEmail ? "Même email dans un autre pays" : "",
        contactPhone ? "Même téléphone dans un autre pays" : "",
      ].filter(Boolean);
      matches.push({ school: item, level: CROSS_COUNTRY_CONTACT_MATCH, reasons });
    }
  }
  return matches;
}

function findPotentialDuplicates(school, schools = []) {
  return classifySchoolDuplicates(school, schools).filter(
    (match) => match.level === DUPLICATE_STRONG || match.level === DUPLICATE_CONTACT,
  );
}

module.exports = {
  SCHOOL_TYPES,
  DUPLICATE_STRONG,
  DUPLICATE_CONTACT,
  CROSS_COUNTRY_CONTACT_MATCH,
  normalize,
  generateSchoolCode,
  isSchoolDeleted,
  filterActiveSchools,
  validateSchoolPayload,
  isGenericSchoolEmail,
  isGenericSchoolPhone,
  classifySchoolDuplicates,
  findPotentialDuplicates,
};
