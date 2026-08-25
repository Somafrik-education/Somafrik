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
const INACTIVE_STUDENT_STATUSES = new Set([
  "inactive",
  "inactif",
  "archived",
  "archive",
  "archivé",
  "deleted",
  "supprime",
  "supprimé",
]);

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeSchoolLookup(value) {
  return String(value ?? "").trim().toUpperCase();
}

function schoolLookupKeys(school = {}) {
  return [
    school.id,
    school.code,
    school.schoolCode,
    school.school_code,
    school.publicId,
    school.loginCode,
    school.login_code,
    school.legacySchoolCode,
    school.legacy_school_code,
  ]
    .map(normalizeSchoolLookup)
    .filter(Boolean);
}

/**
 * Agrège les effectifs actifs sans exposer les fiches élèves au client plateforme.
 * Complexité O(établissements + élèves) : un seul index d'alias puis un seul passage
 * sur la projection PostgreSQL canonique des élèves.
 */
function withActiveStudentCounts(schools = [], students = []) {
  const rows = Array.isArray(schools) ? schools : [];
  const counts = new Array(rows.length).fill(0);
  const schoolIndexByLookup = new Map();

  rows.forEach((school, index) => {
    for (const key of schoolLookupKeys(school)) {
      schoolIndexByLookup.set(key, index);
    }
  });

  for (const student of Array.isArray(students) ? students : []) {
    if (INACTIVE_STUDENT_STATUSES.has(normalize(student?.status))) continue;
    const studentSchoolKeys = [
      student?.schoolId,
      student?.school_id,
      student?.schoolCode,
      student?.school_code,
    ]
      .map(normalizeSchoolLookup)
      .filter(Boolean);
    const index = studentSchoolKeys
      .map((key) => schoolIndexByLookup.get(key))
      .find((value) => value !== undefined);
    if (index !== undefined) counts[index] += 1;
  }

  return rows.map((school, index) => ({ ...school, studentCount: counts[index] }));
}

/**
 * Compatibilité d'appel uniquement.
 * Ni le backend applicatif ni les clients n'allouent login_code V2 :
 * PostgreSQL (`somafrik_prepare_school_login_code`) est l'unique générateur.
 * school_code interne SCH-* est alloué à la persistance, pas ici.
 */
function generateSchoolCode(_countryCode, _schools = []) {
  void _countryCode;
  void _schools;
  return "";
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

function schoolConflictsExistingIdentity(school, existing, { isNew = false } = {}) {
  const { matchesSchoolLookup } = require("./schoolCodeV2");
  if (!isNew && normalize(existing.code) === normalize(school.code) && school.code) {
    return false;
  }
  const candidates = [
    school.requestedCode,
    school.code,
    school.loginCode,
    school.login_code,
    school.publicId,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return candidates.some((value) => matchesSchoolLookup(existing, value));
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

  const { isLegacySchoolCodeFormat } = require("./schoolCodeV2");
  const requested = String(school.requestedCode ?? school.code ?? "").trim().toUpperCase();
  const code = String(school.code ?? "").trim().toUpperCase();
  if (isNew) {
    if (requested && isLegacySchoolCodeFormat(requested)) {
      return "Format établissement legacy interdit pour une création (ex. CD-2026-0001).";
    }
  } else if (!code) {
    return "Le code établissement est obligatoire.";
  }
  const duplicateCode = (schools ?? []).some((item) =>
    schoolConflictsExistingIdentity(school, item, { isNew }),
  );
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
  withActiveStudentCounts,
  validateSchoolPayload,
  isGenericSchoolEmail,
  isGenericSchoolPhone,
  classifySchoolDuplicates,
  findPotentialDuplicates,
};
