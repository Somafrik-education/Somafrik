"use strict";

/**
 * Alloue le prochain couple identifiant / codes enseignant pour un établissement.
 * Format login : ENS-#### ; codes techniques : {schoolCode}-ENS-#### (unicité globale).
 */

/**
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
function extractEnsSequence(value) {
  const match = String(value ?? "").match(/ENS-(\d+)$/i);
  if (!match?.[1]) return null;
  const sequence = Number(match[1]);
  return Number.isFinite(sequence) ? sequence : null;
}

/**
 * @param {string} schoolCode
 * @param {string[]} existingCodes
 * @returns {{ identifier: string, teacherCode: string, userCode: string, publicId: string }}
 */
function generateNextTeacherCodes(schoolCode, existingCodes = []) {
  const normalizedSchool = String(schoolCode ?? "").trim().toUpperCase();
  let max = 0;
  for (const code of existingCodes) {
    const sequence = extractEnsSequence(code);
    if (sequence != null) {
      max = Math.max(max, sequence);
    }
  }
  const identifier = `ENS-${String(max + 1).padStart(4, "0")}`;
  const teacherCode = normalizedSchool ? `${normalizedSchool}-${identifier}` : identifier;
  return {
    identifier,
    teacherCode,
    userCode: teacherCode,
    publicId: teacherCode,
  };
}

const TEACHER_CODE_UNIQUE_CONSTRAINT = "teachers_teacher_code_key";
const USER_CODE_UNIQUE_CONSTRAINT = "users_user_code_key";

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTeacherOrUserCodeUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") {
    return false;
  }
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "").toLowerCase();
  if (constraint === TEACHER_CODE_UNIQUE_CONSTRAINT || constraint === USER_CODE_UNIQUE_CONSTRAINT) {
    return true;
  }
  return (
    detail.includes("(teacher_code)=") ||
    detail.includes("(user_code)=") ||
    detail.includes("teacher_code") ||
    detail.includes("user_code")
  );
}

/**
 * Verrou transactionnel établissement pour création enseignant (codes + identité).
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<unknown> }} db
 * @param {string} schoolId
 */
async function acquireTeacherSchoolCreationLock(db, schoolId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [`teacher-code:${schoolId}`]);
}

/**
 * @param {{
 *   query: (sql: string, params?: unknown[]) => Promise<unknown>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 * }} db
 * @param {string} schoolId
 * @param {string} schoolCode
 * @param {{ alreadyLocked?: boolean }} [options]
 */
async function allocateTeacherCodesLocked(db, schoolId, schoolCode, options = {}) {
  if (!options.alreadyLocked) {
    await acquireTeacherSchoolCreationLock(db, schoolId);
  }
  const teacherRows = await db.all(
    `SELECT teacher_code AS code FROM teachers WHERE school_id = $1`,
    [schoolId],
  );
  const userRows = await db.all(
    `SELECT user_code AS code FROM users WHERE school_id = $1`,
    [schoolId],
  );
  const existing = [...teacherRows, ...userRows].map((row) => row.code);
  return generateNextTeacherCodes(schoolCode, existing);
}

module.exports = {
  TEACHER_CODE_UNIQUE_CONSTRAINT,
  USER_CODE_UNIQUE_CONSTRAINT,
  extractEnsSequence,
  generateNextTeacherCodes,
  isTeacherOrUserCodeUniquenessViolation,
  acquireTeacherSchoolCreationLock,
  allocateTeacherCodesLocked,
};
