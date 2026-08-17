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
const MEMORY_STUDENT_INITIALS = "EL";

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

  const hasIdentityContext = Boolean(
    String(student.studentInitials ?? "").trim() ||
    String(student.firstName ?? "").trim() ||
    String(student.lastName ?? "").trim(),
  );

  // Compatibilité exclusivement pour l'ancien adaptateur mémoire qui intercepte
  // INSERT students sans transmettre encore firstName/lastName à cet helper.
  // En production PostgreSQL cette fonction n'alloue jamais : le trigger lit
  // directement NEW.first_name / NEW.last_name et produit les vraies initiales.
  const fallbackInitials = hasIdentityContext ? undefined : MEMORY_STUDENT_INITIALS;

  return generateNextStudentCanonicalCode({
    ...resolveSchoolIdentityContext(school),
    studentInitials: student.studentInitials || fallbackInitials,
    firstName: student.firstName,
    lastName: student.lastName,
    existingCodes,
  });
}

module.exports = {
  STUDENT_CODE_UNIQUE_CONSTRAINT,
  MEMORY_STUDENT_INITIALS,
  isStudentCodeUniquenessViolation,
  assignCanonicalStudentCode,
};
