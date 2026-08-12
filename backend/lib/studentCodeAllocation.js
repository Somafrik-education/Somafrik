"use strict";

const { generateNextStudentCode } = require("./studentCodeGeneration");

const STUDENT_CODE_UNIQUE_CONSTRAINT = "students_student_code_key";

/**
 * @param {unknown} error
 * @returns {boolean}
 */
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
 * Verrou transactionnel + lecture des matricules existants pour l'établissement.
 * @param {{
 *   query: (sql: string, params?: unknown[]) => Promise<unknown>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 * }} db
 * @param {string} schoolId
 * @param {string} schoolCode
 * @returns {Promise<string>}
 */
async function allocateStudentCodeLocked(db, schoolId, schoolCode) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [`student-code:${schoolId}`]);
  const rows = await db.all(
    `SELECT student_code FROM students WHERE school_id = $1`,
    [schoolId],
  );
  return generateNextStudentCode(
    schoolCode,
    rows.map((row) => row.student_code),
  );
}

module.exports = {
  STUDENT_CODE_UNIQUE_CONSTRAINT,
  isStudentCodeUniquenessViolation,
  allocateStudentCodeLocked,
};
