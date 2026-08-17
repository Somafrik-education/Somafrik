"use strict";

/**
 * Identifiant canonique élève = matricule = identifiant de connexion.
 * Format : {ISO_PAYS}-{INITIALES_ETAB}-EL-{YY}-{SEQ3}
 * Exemple : CD-IN-EL-26-001
 *
 * PostgreSQL est l'autorité (compteur + UNIQUE). Ce module est le miroir JS
 * pour les chemins mémoire / allocation transactionnelle alignée.
 */

const {
  asciiUpper,
  normalizeSchoolShortCode,
  schoolShortCodeFromName,
} = require("./permanentIdentifier");

const STUDENT_PROFILE = "EL";
const STUDENT_SEQUENCE_MAX = 999;
const STUDENT_CANONICAL_RE = /^([A-Z]{2})-([A-Z0-9]{2,5})-EL-([0-9]{2})-([0-9]{3})$/;
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

function isStudentCanonicalCode(value) {
  return STUDENT_CANONICAL_RE.test(String(value ?? "").trim().toUpperCase());
}

function parseStudentCanonicalCode(value) {
  const match = STUDENT_CANONICAL_RE.exec(String(value ?? "").trim().toUpperCase());
  if (!match) return null;
  return {
    countryCode: match[1],
    schoolInitials: match[2],
    yearShort: match[3],
    sequence: Number(match[4]),
  };
}

function formatStudentCanonicalCode({ countryCode, schoolInitials, year, sequence }) {
  const country = asciiUpper(countryCode).replace(/[^A-Z]/g, "");
  if (country.length !== 2) {
    const error = new Error("COUNTRY_CODE_INVALID");
    error.code = "COUNTRY_CODE_INVALID";
    throw error;
  }
  return `${country}-${normalizeSchoolShortCode(schoolInitials)}-${STUDENT_PROFILE}-${yearShort(year)}-${String(assertSequence(sequence)).padStart(3, "0")}`;
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
  year = new Date().getFullYear(),
  existingCodes = [],
} = {}) {
  const yy = yearShort(year);
  const country = asciiUpper(countryCode).replace(/[^A-Z]/g, "");
  const initials = normalizeSchoolShortCode(schoolInitials);
  let max = 0;
  for (const code of existingCodes) {
    const parsed = parseStudentCanonicalCode(code);
    if (!parsed) continue;
    if (parsed.countryCode !== country || parsed.schoolInitials !== initials || parsed.yearShort !== yy) {
      continue;
    }
    max = Math.max(max, parsed.sequence);
  }
  return formatStudentCanonicalCode({
    countryCode: country,
    schoolInitials: initials,
    year,
    sequence: max + 1,
  });
}

module.exports = {
  STUDENT_PROFILE,
  STUDENT_SEQUENCE_MAX,
  STUDENT_CANONICAL_RE,
  isStudentCanonicalCode,
  parseStudentCanonicalCode,
  formatStudentCanonicalCode,
  resolveSchoolIdentityContext,
  generateNextStudentCanonicalCode,
};
