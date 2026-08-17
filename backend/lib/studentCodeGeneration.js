"use strict";

/**
 * Matricule élève = identifiant de connexion.
 * Format canonique : {ISO}-{INITIALES}-EL-{YY}-{SEQ3} (ex. CD-IN-EL-26-001).
 * L'ancien format ELE-pays-établissement-année-séquence n'est plus émis.
 */

const {
  formatStudentCanonicalCode,
  generateNextStudentCanonicalCode,
  isStudentCanonicalCode,
  parseStudentCanonicalCode,
  resolveSchoolIdentityContext,
} = require("./studentCanonicalIdentifier");

const STUDENT_PROFILE = "EL";

function generateNextStudentCode(schoolCode, existingCodes = [], school = {}) {
  const context = resolveSchoolIdentityContext({
    school_code: schoolCode,
    ...school,
  });
  return generateNextStudentCanonicalCode({
    ...context,
    existingCodes,
  });
}

function formatStudentCode(schoolCode, sequence, school = {}) {
  const context = resolveSchoolIdentityContext({
    school_code: schoolCode,
    ...school,
  });
  return formatStudentCanonicalCode({
    ...context,
    year: new Date().getFullYear(),
    sequence,
  });
}

function studentCodePrefix(schoolCode, school = {}) {
  const context = resolveSchoolIdentityContext({
    school_code: schoolCode,
    ...school,
  });
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
  return `${context.countryCode}-${context.schoolInitials}-${STUDENT_PROFILE}-${yy}-`;
}

function extractStudentSequence(studentCode, schoolCode, school = {}) {
  const parsed = parseStudentCanonicalCode(studentCode);
  if (!parsed) return null;
  const context = resolveSchoolIdentityContext({
    school_code: schoolCode,
    ...school,
  });
  if (parsed.countryCode !== context.countryCode || parsed.schoolInitials !== context.schoolInitials) {
    return null;
  }
  return parsed.sequence;
}

module.exports = {
  STUDENT_PROFILE,
  parseStudentCanonicalCode,
  isStudentCanonicalCode,
  resolveSchoolIdentityContext,
  studentCodePrefix,
  formatStudentCode,
  extractStudentSequence,
  generateNextStudentCode,
};
