"use strict";

/**
 * Identifiant canonique élève = matricule = identifiant de connexion.
 * Format : {ISO_PAYS}-{INITIALES_ETAB}-{INITIALES_ELEVE}-{YY}-{SEQ5}
 * Exemple : CD-IN-OHS-26-00001 pour OKITO Hope Sabrina.
 *
 * PostgreSQL est l'unique allocateur en production (trigger + compteur).
 * Ce module est le miroir JS pour les chemins mémoire/tests.
 */

const {
  asciiUpper,
  normalizeSchoolShortCode,
  schoolShortCodeFromName,
} = require("./permanentIdentifier");

// Conservé uniquement pour compatibilité d'import ; le segment EL n'existe plus dans le code canonique.
const STUDENT_PROFILE = "";
const STUDENT_CODE_PLACEHOLDER = "PENDING";
const STUDENT_SEQUENCE_MAX = 99_999;
const STUDENT_CANONICAL_RE = /^([A-Z]{2})-([A-Z0-9]{2,5})-([A-Z0-9]{1,5})-([0-9]{2})-([0-9]{5})$/;
const SCHOOL_LOGIN_RE = /^([A-Z]{2})-([A-Z0-9]{2,5})-([0-9]{2})-([0-9]{3})$/;
const INTERNAL_SCHOOL_CODE_RE = /^([A-Z]{2})-(\d{4})-(\d{4})$/;

function yearShort(year) {
  const numeric = Number(year);
  if (!Number.isInteger(numeric) || numeric < 2000 || numeric > 9999) {
    const error = new Error("STUDENT_YEAR_INVALID");
    error.code = "STUDENT_YEAR_INVALID";
    throw error;
  }
  return String(numeric % 100).padStart(2, "0");
}

function assertSequence(sequence) {
  const numeric = Number(sequence);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > STUDENT_SEQUENCE_MAX) {
    const error = new Error("STUDENT_SEQUENCE_EXHAUSTED");
    error.code = "STUDENT_SEQUENCE_EXHAUSTED";
    throw error;
  }
  return numeric;
}

function studentIdentityInitials(lastName, firstName) {
  const normalized = asciiUpper(`${String(lastName ?? "").trim()} ${String(firstName ?? "").trim()}`)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  let initials = tokens.map((token) => token[0]).join("").slice(0, 5);
  if (!initials) {
    const error = new Error("STUDENT_INITIALS_REQUIRED");
    error.code = "STUDENT_INITIALS_REQUIRED";
    throw error;
  }
  if (initials.length < 2) {
    const compact = tokens.join("");
    initials = (initials + compact.slice(1)).slice(0, 5);
  }
  return initials;
}

function normalizeStudentInitials(value) {
  const normalized = asciiUpper(value).replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (!normalized) {
    const error = new Error("STUDENT_INITIALS_REQUIRED");
    error.code = "STUDENT_INITIALS_REQUIRED";
    throw error;
  }
  return normalized;
}

function isStudentCanonicalCode(value) {
  return STUDENT_CANONICAL_RE.test(String(value ?? "").trim().toUpperCase());
}

function parseStudentCanonicalCode(value) {
  const match = STUDENT_CANONICAL_RE.exec(String(value ?? "").trim().toUpperCase());
  if (!match) return null;
  return {
    countryCode: match[1],
    schoolInitials: match[2],
    studentInitials: match[3],
    yearShort: match[4],
    sequence: Number(match[5]),
  };
}

function formatStudentCanonicalCode({ countryCode, schoolInitials, studentInitials, year, sequence }) {
  const country = asciiUpper(countryCode).replace(/[^A-Z]/g, "");
  if (country.length !== 2) {
    const error = new Error("COUNTRY_CODE_INVALID");
    error.code = "COUNTRY_CODE_INVALID";
    throw error;
  }
  return `${country}-${normalizeSchoolShortCode(schoolInitials)}-${normalizeStudentInitials(studentInitials)}-${yearShort(year)}-${String(assertSequence(sequence)).padStart(5, "0")}`;
}

function resolveSchoolIdentityContext(school = {}) {
  const login = String(school.login_code ?? school.loginCode ?? "").trim().toUpperCase();
  const loginMatch = SCHOOL_LOGIN_RE.exec(login);
  if (loginMatch) {
    return {
      countryCode: loginMatch[1],
      schoolInitials: loginMatch[2],
    };
  }

  const internal = String(school.school_code ?? school.schoolCode ?? "").trim().toUpperCase();
  const internalMatch = INTERNAL_SCHOOL_CODE_RE.exec(internal);
  const countryCode = asciiUpper(
    school.country_code ?? school.countryCode ?? school.iso_code ?? internalMatch?.[1] ?? "",
  ).replace(/[^A-Z]/g, "");

  const shortCode = String(school.short_code ?? school.shortCode ?? "").trim();
  if (shortCode) {
    return {
      countryCode,
      schoolInitials: normalizeSchoolShortCode(shortCode),
    };
  }

  const name = String(school.name ?? "").trim();
  if (name) {
    return {
      countryCode,
      schoolInitials: schoolShortCodeFromName(name),
    };
  }

  const error = new Error("SCHOOL_INITIALS_REQUIRED");
  error.code = "SCHOOL_INITIALS_REQUIRED";
  throw error;
}

function generateNextStudentCanonicalCode({
  countryCode,
  schoolInitials,
  studentInitials,
  firstName,
  lastName,
  year = new Date().getFullYear(),
  existingCodes = [],
} = {}) {
  const yy = yearShort(year);
  const country = asciiUpper(countryCode).replace(/[^A-Z]/g, "");
  const school = normalizeSchoolShortCode(schoolInitials);
  const person = normalizeStudentInitials(
    studentInitials || studentIdentityInitials(lastName, firstName),
  );
  let max = 0;
  for (const code of existingCodes) {
    const parsed = parseStudentCanonicalCode(code);
    if (!parsed) continue;
    // Le compteur est partagé par établissement + année ; les initiales ne créent pas un namespace séparé.
    if (parsed.countryCode !== country || parsed.schoolInitials !== school || parsed.yearShort !== yy) {
      continue;
    }
    max = Math.max(max, parsed.sequence);
  }
  return formatStudentCanonicalCode({
    countryCode: country,
    schoolInitials: school,
    studentInitials: person,
    year,
    sequence: max + 1,
  });
}

module.exports = {
  STUDENT_PROFILE,
  STUDENT_CODE_PLACEHOLDER,
  STUDENT_SEQUENCE_MAX,
  STUDENT_CANONICAL_RE,
  studentIdentityInitials,
  normalizeStudentInitials,
  isStudentCanonicalCode,
  parseStudentCanonicalCode,
  formatStudentCanonicalCode,
  resolveSchoolIdentityContext,
  generateNextStudentCanonicalCode,
};
