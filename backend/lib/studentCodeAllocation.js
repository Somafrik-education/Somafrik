"use strict";

/**
 * Allocation du matricule élève canonique (même valeur que l'identifiant de connexion).
 * Format : CD-IN-EL-26-001. Unicité PostgreSQL : students.student_code UNIQUE.
 */

const {
  generateNextStudentCanonicalCode,
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

function currentIdentityYear() {
  return new Date().getFullYear();
}

/**
 * Verrou transactionnel + lecture des matricules existants (namespace pays/initiales/année).
 * @param {{
 *   query: (sql: string, params?: unknown[]) => Promise<unknown>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 * }} db
 * @param {{ id: string, school_code?: string, login_code?: string, loginCode?: string, name?: string, short_code?: string, country_code?: string }} school
 * @returns {Promise<string>}
 */
async function allocateStudentCodeLocked(db, school) {
  const context = resolveSchoolIdentityContext(school);
  const year = currentIdentityYear();
  const lockKey = `student-canonical:${context.countryCode}:${context.schoolInitials}:${year}`;
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [lockKey]);
  const rows = await db.all(`SELECT student_code FROM students`);
  return generateNextStudentCanonicalCode({
    ...context,
    year,
    existingCodes: rows.map((row) => row.student_code),
  });
}

module.exports = {
  STUDENT_CODE_UNIQUE_CONSTRAINT,
  isStudentCodeUniquenessViolation,
  allocateStudentCodeLocked,
};
