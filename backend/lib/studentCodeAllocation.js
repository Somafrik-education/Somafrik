"use strict";

/**
 * Stand-in mémoire du trigger PostgreSQL `somafrik_assign_permanent_student_identity`.
 * Ne pas appeler sur le chemin d'inscription PostgreSQL : le trigger alloue.
 */

const {
  generateNextStudentCanonicalCode,
  isStudentCanonicalCode,
  resolveSchoolIdentityContext,
} = require("./studentCanonicalIdentifier");

const STUDENT_CODE_UNIQUE_CONSTRAINT = "students_student_code_key";

function isStudentCodeUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") {
    return false;
  }
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  if (constraint === STUDENT_CODE_UNIQUE_CONSTRAINT) {
    return true;
  }
  return detail.includes("(student_code)=") || detail.toLowerCase().includes("student_code");
}

/**
 * @param {{ login_code?: string, loginCode?: string, name?: string, short_code?: string, school_code?: string, country_code?: string }} school
 * @param {string[]} existingCodes
 * @param {string} [requested]
 * @returns {string}
 */
function assignCanonicalStudentCode(school, existingCodes = [], requested = "") {
  const value = String(requested ?? "").trim().toUpperCase();
  if (isStudentCanonicalCode(value)) return value;
  return generateNextStudentCanonicalCode({
    ...resolveSchoolIdentityContext(school),
    existingCodes,
  });
}

module.exports = {
  STUDENT_CODE_UNIQUE_CONSTRAINT,
  isStudentCodeUniquenessViolation,
  assignCanonicalStudentCode,
};
