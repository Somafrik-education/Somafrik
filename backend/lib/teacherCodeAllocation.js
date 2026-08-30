"use strict";

/**
 * Allocation enseignant V2 — une seule autorité stockée.
 *
 * users.user_code = {ISO}-{ETAB}-{INITIALES}-{YY}-{SEQ5}
 *   ex. CD-IN-JPM-26-00001
 *
 * teachers.teacher_code = colonne de transition (dual-write B/C, DROP Lot D).
 * Identité publique = users.user_code via teachers.user_id (JOIN).
 * Lookup : UUID teacher, UUID user, users.user_code. Jamais teacher_code.
 * Jamais ENS-####, jamais suffixe, jamais legacy_teacher_code.
 */

const {
  formatIdentityCode,
  identityInitials,
  schoolShortCodeFromName,
} = require("./permanentIdentifier");
const { isV2SchoolLoginCode, normalizeSchoolCode } = require("./schoolCodeV2");

const TEACHER_CODE_UNIQUE_CONSTRAINT = "teachers_teacher_code_key";
const USER_CODE_UNIQUE_CONSTRAINT = "users_user_code_key";
const PERSON_IDENTITY_RE = /^([A-Z]{2})-([A-Z0-9]{2,5})-([A-Z0-9]{1,5})-(\d{2})-(\d{5})$/;

function normalizeIdentityCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isPersonIdentityCode(value) {
  return PERSON_IDENTITY_RE.test(normalizeIdentityCode(value));
}

function parsePersonIdentityCode(value) {
  const match = PERSON_IDENTITY_RE.exec(normalizeIdentityCode(value));
  if (!match) return null;
  return {
    countryIso: match[1],
    schoolInitials: match[2],
    initials: match[3],
    yearShort: match[4],
    sequence: Number(match[5]),
  };
}

function schoolIdentityFromRecord(school = {}) {
  const login = normalizeSchoolCode(school.loginCode ?? school.login_code ?? school);
  if (typeof school === "string") {
    if (isV2SchoolLoginCode(school)) {
      const parts = normalizeSchoolCode(school).split("-");
      return { countryIso: parts[0], schoolInitials: parts[1] };
    }
    const error = new Error("SCHOOL_LOGIN_CODE_REQUIRED");
    error.code = "SCHOOL_LOGIN_CODE_REQUIRED";
    throw error;
  }
  if (isV2SchoolLoginCode(login)) {
    const parts = login.split("-");
    return { countryIso: parts[0], schoolInitials: parts[1], loginCode: login };
  }
  const countryIso = normalizeSchoolCode(
    school.countryIso ?? school.country_code ?? school.iso_code ?? "",
  ).slice(0, 2);
  const shortCode = String(school.shortCode ?? school.short_code ?? "").trim();
  if (countryIso && shortCode) {
    return {
      countryIso,
      schoolInitials: shortCode.replace(/[^A-Z0-9]/gi, "").slice(0, 5).toUpperCase(),
      loginCode: login,
    };
  }
  const name = String(school.name ?? "").trim();
  if (countryIso && name) {
    return { countryIso, schoolInitials: schoolShortCodeFromName(name), loginCode: login };
  }
  const error = new Error("SCHOOL_LOGIN_CODE_REQUIRED");
  error.code = "SCHOOL_LOGIN_CODE_REQUIRED";
  throw error;
}

/**
 * Identité publique unique — plus de login court ENS-####.
 * @returns {{ identifier: string, teacherCode: string, userCode: string, publicId: string, identityCode: string }}
 */
function formatCanonicalTeacherCodes(school, person, sequence, year = new Date().getFullYear()) {
  const { countryIso, schoolInitials } = schoolIdentityFromRecord(school);
  const firstName = person?.firstName ?? person?.first_name ?? "";
  const lastName = person?.lastName ?? person?.last_name ?? "";
  const initials = person?.initials ?? identityInitials(firstName, lastName);
  const identityCode = formatIdentityCode({
    countryCode: countryIso,
    schoolShortCode: schoolInitials,
    initials,
    year,
    sequence,
  });
  return {
    identifier: identityCode,
    teacherCode: identityCode,
    userCode: identityCode,
    publicId: identityCode,
    identityCode,
  };
}

function maxIdentitySequence(existingCodes, countryIso, schoolInitials) {
  const iso = normalizeIdentityCode(countryIso);
  const school = normalizeIdentityCode(schoolInitials);
  let max = 0;
  for (const code of existingCodes ?? []) {
    const parsed = parsePersonIdentityCode(code);
    if (!parsed) continue;
    if (parsed.countryIso !== iso || parsed.schoolInitials !== school) continue;
    max = Math.max(max, parsed.sequence);
  }
  return max;
}

function generateNextTeacherCodes(school, existingCodes = [], person = {}, year = new Date().getFullYear()) {
  const { countryIso, schoolInitials } = schoolIdentityFromRecord(school);
  const sequence = maxIdentitySequence(existingCodes, countryIso, schoolInitials) + 1;
  return formatCanonicalTeacherCodes(school, person, sequence, year);
}

function teacherPublicCodesMatch(stored, lookup) {
  const a = normalizeIdentityCode(stored);
  const b = normalizeIdentityCode(lookup);
  if (!b) return false;
  return a === b;
}

function sqlTeacherPublicCodeEquals(userAlias, param) {
  return `${userAlias}.user_code = ${param}`;
}

function sqlTeacherPublicCodeEqualsAny(userAlias, param) {
  return `${userAlias}.user_code = ANY(${param})`;
}

function sqlTeacherIdentityEquals(teacherAlias, userAlias, param) {
  if (!userAlias) {
    throw new Error("sqlTeacherIdentityEquals requires a users alias — identity is users.user_code");
  }
  return `(
    ${teacherAlias}.id::text = ${param}
    OR ${userAlias}.id::text = ${param}
    OR ${sqlTeacherPublicCodeEquals(userAlias, param)}
  )`;
}

function sqlTeacherIdentityEqualsAny(teacherAlias, userAlias, param) {
  if (!userAlias) {
    throw new Error("sqlTeacherIdentityEqualsAny requires a users alias — identity is users.user_code");
  }
  return `(
    ${teacherAlias}.id::text = ANY(${param})
    OR ${userAlias}.id::text = ANY(${param})
    OR ${sqlTeacherPublicCodeEqualsAny(userAlias, param)}
  )`;
}

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

async function acquireTeacherSchoolCreationLock(db, schoolId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [`teacher-code:${schoolId}`]);
}

async function allocateTeacherCodesLocked(db, schoolId, school, options = {}) {
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
  const year = Number(options.year ?? new Date().getFullYear());
  return generateNextTeacherCodes(school, existing, {
    firstName: options.firstName ?? options.first_name,
    lastName: options.lastName ?? options.last_name,
    initials: options.initials,
  }, year);
}

module.exports = {
  TEACHER_CODE_UNIQUE_CONSTRAINT,
  USER_CODE_UNIQUE_CONSTRAINT,
  PERSON_IDENTITY_RE,
  normalizeIdentityCode,
  isPersonIdentityCode,
  parsePersonIdentityCode,
  schoolIdentityFromRecord,
  formatCanonicalTeacherCodes,
  generateNextTeacherCodes,
  teacherPublicCodesMatch,
  sqlTeacherPublicCodeEquals,
  sqlTeacherPublicCodeEqualsAny,
  sqlTeacherIdentityEquals,
  sqlTeacherIdentityEqualsAny,
  isTeacherOrUserCodeUniquenessViolation,
  acquireTeacherSchoolCreationLock,
  allocateTeacherCodesLocked,
};
