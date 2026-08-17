"use strict";

/**
 * Matricule élève = identifiant de connexion.
 * Format canonique : {ISO}-{ETAB}-{INITIALES_ELEVE}-{YY}-{SEQ5}
 * (ex. CD-IN-OHS-26-00001).
 * PostgreSQL reste l'allocateur autoritaire ; ces helpers servent aux tests/mémoire.
 */

const {
  formatStudentCanonicalCode,
  generateNextStudentCanonicalCode,
  isStudentCanonicalCode,
  parseStudentCanonicalCode,
  resolveSchoolIdentityContext,
  studentIdentityInitials,
} = require("./studentCanonicalIdentifier");

const STUDENT_PROFILE = "";

function resolvePerson(student = {}) {
  return student.studentInitials || studentIdentityInitials(student.lastName, student.firstName);
}

function generateNextStudentCode(schoolCode, existingCodes = [], school = {}, student = {}) {
  const context = resolveSchoolIdentityContext({ school_code: schoolCode, ...school });
  return generateNextStudentCanonicalCode({
    ...context,
    studentInitials: resolvePerson(student),
    existingCodes,
  });
}

function formatStudentCode(schoolCode, sequence, school = {}, student = {}) {
  const context = resolveSchoolIdentityContext({ school_code: schoolCode, ...school });
  return formatStudentCanonicalCode({
    ...context,
    studentInitials: resolvePerson(student),
    year: new Date().getFullYear(),
    sequence,
  });
}

function studentCodePrefix(schoolCode, school = {}, student = {}) {
  const context = resolveSchoolIdentityContext({ school_code: schoolCode, ...school });
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
  return `${context.countryCode}-${context.schoolInitials}-${resolvePerson(student)}-${yy}-`;
}

function extractStudentSequence(studentCode, schoolCode, school = {}) {
  const parsed = parseStudentCanonicalCode(studentCode);
  if (!parsed) return null;
  const context = resolveSchoolIdentityContext({ school_code: schoolCode, ...school });
  if (parsed.countryCode !== context.countryCode || parsed.schoolInitials !== context.schoolInitials) return null;
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
