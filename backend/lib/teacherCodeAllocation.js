"use strict";

/**
 * Alloue le prochain couple identifiant / codes enseignant pour un établissement.
 * Format login : ENS-#### ; codes techniques : {schoolCode}-ENS-#### (unicité globale).
 */

const LEGACY_SHORT_TEACHER_CODE_RE = /^ENS-\d+$/i;

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
 * Identifiant court de connexion (ex. ENS-0001), suffixe du code technique.
 * @param {string | null | undefined} code
 * @returns {string}
 */
function extractTeacherLoginId(code) {
  const match = String(code ?? "").match(/(ENS-\d+)$/i);
  return match ? match[1].toUpperCase() : "";
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function isLegacyShortTeacherCode(value) {
  return LEGACY_SHORT_TEACHER_CODE_RE.test(String(value ?? "").trim());
}

/**
 * Règle officielle actuelle (nouveaux enseignants) :
 * login identifier = ENS-#### ;
 * teacherCode / userCode / publicId = {schoolCode}-ENS-####.
 *
 * @param {string} schoolCode
 * @param {number} sequence
 * @returns {{ identifier: string, teacherCode: string, userCode: string, publicId: string }}
 */
function formatCanonicalTeacherCodes(schoolCode, sequence) {
  const normalizedSchool = String(schoolCode ?? "").trim().toUpperCase();
  const identifier = `ENS-${String(Number(sequence)).padStart(4, "0")}`;
  const teacherCode = normalizedSchool ? `${normalizedSchool}-${identifier}` : identifier;
  return {
    identifier,
    teacherCode,
    userCode: teacherCode,
    publicId: teacherCode,
  };
}

/**
 * @param {string | null | undefined} stored
 * @param {string | null | undefined} lookup
 * @returns {boolean}
 */
function teacherPublicCodesMatch(stored, lookup) {
  const a = String(stored ?? "").trim().toUpperCase();
  const b = String(lookup ?? "").trim().toUpperCase();
  if (!b) return true;
  if (a === b) return true;
  if (isLegacyShortTeacherCode(b) && a.endsWith(`-${b}`)) return true;
  if (isLegacyShortTeacherCode(a) && b.endsWith(`-${a}`)) return true;
  return false;
}

/**
 * Prédicat SQL : code public enseignant (canonique, legacy court, suffixe ENS-####).
 * @param {string} alias table teachers
 * @param {string} param ex. `$2` ou `ANY($2::text[])`
 */
function sqlTeacherPublicCodeEquals(alias, param) {
  return `(
    ${alias}.teacher_code = ${param}
    OR ${alias}.legacy_teacher_code = ${param}
    OR (
      ${param} ~* '^ENS-[0-9]+$'
      AND right(${alias}.teacher_code, char_length(${param}) + 1) = '-' || upper(${param})
    )
  )`;
}

/**
 * @param {string} alias
 * @param {string} param ex. `$2::text[]`
 */
function sqlTeacherPublicCodeEqualsAny(alias, param) {
  return `(
    ${alias}.teacher_code = ANY(${param})
    OR ${alias}.legacy_teacher_code = ANY(${param})
    OR EXISTS (
      SELECT 1 FROM unnest(${param}) AS lookup(code)
      WHERE lookup.code ~* '^ENS-[0-9]+$'
        AND right(${alias}.teacher_code, char_length(lookup.code) + 1) = '-' || upper(lookup.code)
    )
  )`;
}

/**
 * Identité enseignant : UUID, codes publics, user_code, alias login ENS-####.
 * @param {string} teacherAlias
 * @param {string | null} userAlias LEFT JOIN users, ou null
 * @param {string} param
 */
function sqlTeacherIdentityEquals(teacherAlias, userAlias, param) {
  const userPart = userAlias
    ? `OR ${userAlias}.id::text = ${param}
       OR ${userAlias}.user_code = ${param}
       OR (
         ${param} ~* '^ENS-[0-9]+$'
         AND ${userAlias}.user_code IS NOT NULL
         AND right(${userAlias}.user_code, char_length(${param}) + 1) = '-' || upper(${param})
       )`
    : "";
  return `(
    ${teacherAlias}.id::text = ${param}
    OR ${sqlTeacherPublicCodeEquals(teacherAlias, param).slice(1, -1)}
    ${userPart}
  )`;
}

/**
 * @param {string} teacherAlias
 * @param {string | null} userAlias
 * @param {string} param ex. `$2::text[]`
 */
function sqlTeacherIdentityEqualsAny(teacherAlias, userAlias, param) {
  const userPart = userAlias
    ? `OR ${userAlias}.id::text = ANY(${param})
       OR ${userAlias}.user_code = ANY(${param})
       OR EXISTS (
         SELECT 1 FROM unnest(${param}) AS lookup(code)
         WHERE lookup.code ~* '^ENS-[0-9]+$'
           AND ${userAlias}.user_code IS NOT NULL
           AND right(${userAlias}.user_code, char_length(lookup.code) + 1) = '-' || upper(lookup.code)
       )`
    : "";
  return `(
    ${teacherAlias}.id::text = ANY(${param})
    OR ${sqlTeacherPublicCodeEqualsAny(teacherAlias, param).slice(1, -1)}
    ${userPart}
  )`;
}

/**
 * @param {string} schoolCode
 * @param {string[]} existingCodes
 * @returns {{ identifier: string, teacherCode: string, userCode: string, publicId: string }}
 */
function generateNextTeacherCodes(schoolCode, existingCodes = []) {
  let max = 0;
  for (const code of existingCodes) {
    const sequence = extractEnsSequence(code);
    if (sequence != null) {
      max = Math.max(max, sequence);
    }
  }
  return formatCanonicalTeacherCodes(schoolCode, max + 1);
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
  LEGACY_SHORT_TEACHER_CODE_RE,
  extractEnsSequence,
  extractTeacherLoginId,
  isLegacyShortTeacherCode,
  formatCanonicalTeacherCodes,
  teacherPublicCodesMatch,
  sqlTeacherPublicCodeEquals,
  sqlTeacherPublicCodeEqualsAny,
  sqlTeacherIdentityEquals,
  sqlTeacherIdentityEqualsAny,
  generateNextTeacherCodes,
  isTeacherOrUserCodeUniquenessViolation,
  acquireTeacherSchoolCreationLock,
  allocateTeacherCodesLocked,
};
