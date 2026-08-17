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
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  return constraint === STUDENT_CODE_UNIQUE_CONSTRAINT || detail.includes("(student_code)=") || detail.toLowerCase().includes("student_code");
}

/**
 * @param {object} school
 * @param {string[]} existingCodes
 * @param {string} requested
 * @param {{firstName?: string,lastName?: string,studentInitials?: string}} student
 */
function assignCanonicalStudentCode(school, existingCodes = [], requested = "", student = {}) {
  const value = String(requested ?? "").trim().toUpperCase();
  if (isStudentCanonicalCode(value)) return value;
  return generateNextStudentCanonicalCode({
    ...resolveSchoolIdentityContext(school),
    studentInitials: student.studentInitials,
    firstName: student.firstName,
    lastName: student.lastName,
    existingCodes,
  });
}

module.exports = {
  STUDENT_CODE_UNIQUE_CONSTRAINT,
  isStudentCodeUniquenessViolation,
  assignCanonicalStudentCode,
};
