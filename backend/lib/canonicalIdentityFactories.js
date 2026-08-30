"use strict";

/**
 * Factories d'identité canonique V2 — formes de production uniquement.
 *
 * Interdit : CD-2026-0001, ENS-####, publicId distinct, loginCode distinct,
 * school_code / SCH-… comme identité, teacher_code stocké comme 2e autorité,
 * legacy_teacher_code, fabrication client d'un identifiant métier.
 *
 * Allocation réelle = PostgreSQL. Ces helpers existent pour tests / seeds
 * afin qu'ils reproduisent exactement les formes d'identité de production.
 */

const { randomUUID } = require("node:crypto");
const {
  formatIdentityCode,
  identityInitials,
  schoolShortCodeFromName,
} = require("./permanentIdentifier");
const {
  formatSchoolLoginCode,
  isLegacySchoolCodeFormat,
  isV2SchoolLoginCode,
  normalizeSchoolCode,
} = require("./schoolCodeV2");

function assertCanonicalSchoolLoginCode(value) {
  const normalized = normalizeSchoolCode(value);
  if (isLegacySchoolCodeFormat(normalized)) {
    const error = new Error(
      "createCanonicalSchool refuse le format legacy CC-YYYY-NNNN (ex. CD-2026-0001).",
    );
    error.code = "CANONICAL_SCHOOL_LOGIN_LEGACY_FORBIDDEN";
    throw error;
  }
  if (!isV2SchoolLoginCode(normalized)) {
    const error = new Error("createCanonicalSchool exige un login_code V2 (ex. CD-IN-26-001).");
    error.code = "CANONICAL_SCHOOL_LOGIN_INVALID";
    throw error;
  }
  const [countryIso, shortCode] = normalized.split("-");
  return { loginCode: normalized, countryIso, shortCode };
}
const {
  formatStudentCanonicalCode,
  studentIdentityInitials,
} = require("./studentCanonicalIdentifier");

function createCanonicalSchool(overrides = {}) {
  const name = String(overrides.name ?? "Institut Nuru").trim();
  const year = Number(overrides.year ?? 2026);
  const sequence = Number(overrides.sequence ?? 1);
  let countryIso = String(overrides.countryIso ?? "CD").trim().toUpperCase();
  let loginCode;
  let shortCode;
  if (overrides.loginCode != null) {
    const parsed = assertCanonicalSchoolLoginCode(overrides.loginCode);
    loginCode = parsed.loginCode;
    countryIso = parsed.countryIso;
    shortCode = parsed.shortCode;
    if (overrides.shortCode != null) {
      const requested = String(overrides.shortCode).trim().toUpperCase();
      if (requested !== shortCode) {
        const error = new Error(
          `createCanonicalSchool: shortCode ${requested} incompatible avec login_code ${loginCode}.`,
        );
        error.code = "CANONICAL_SCHOOL_SHORT_CODE_MISMATCH";
        throw error;
      }
    }
  } else {
    loginCode = formatSchoolLoginCode({ countryIso, schoolName: name, year, sequence });
    shortCode = schoolShortCodeFromName(name);
    if (overrides.shortCode != null) {
      const requested = String(overrides.shortCode).trim().toUpperCase();
      if (requested !== shortCode) {
        const error = new Error(
          `createCanonicalSchool: shortCode ${requested} incompatible avec le nom « ${name} ».`,
        );
        error.code = "CANONICAL_SCHOOL_SHORT_CODE_MISMATCH";
        throw error;
      }
    }
  }
  return {
    id: overrides.id ?? randomUUID(),
    countryIso,
    name,
    loginCode,
    shortCode,
  };
}

function createCanonicalUser(overrides = {}) {
  const school = overrides.school ?? createCanonicalSchool();
  const firstName = String(overrides.firstName ?? "Jean Pierre").trim();
  const lastName = String(overrides.lastName ?? "Mbuyi").trim();
  const year = Number(overrides.year ?? 2026);
  const sequence = Number(overrides.sequence ?? 1);
  const initials = overrides.initials ?? identityInitials(firstName, lastName);
  const identityCode =
    overrides.identityCode ??
    formatIdentityCode({
      countryCode: school.countryIso,
      schoolShortCode: school.shortCode,
      initials,
      year,
      sequence,
    });
  return {
    id: overrides.id ?? randomUUID(),
    schoolId: school.id,
    firstName,
    lastName,
    identityCode,
    userCode: identityCode,
    publicId: identityCode,
    identifier: identityCode,
    role: overrides.role ?? "Teacher",
    email: overrides.email ?? null,
    phone: overrides.phone ?? null,
  };
}

function createCanonicalTeacher(overrides = {}) {
  const school = overrides.school ?? createCanonicalSchool();
  const user = overrides.user ?? createCanonicalUser({ school, role: "Teacher" });
  // Projection API uniquement — l'autorité stockée est users.user_code via user_id.
  const publicIdentity = user.userCode;
  return {
    id: overrides.id ?? randomUUID(),
    schoolId: school.id,
    userId: user.id,
    teacherCode: publicIdentity,
    publicId: publicIdentity,
    user,
    school,
  };
}

function createCanonicalStudent(overrides = {}) {
  const school = overrides.school ?? createCanonicalSchool();
  const firstName = String(overrides.firstName ?? "Hope Sabrina").trim();
  const lastName = String(overrides.lastName ?? "Okito").trim();
  const year = Number(overrides.year ?? 2026);
  const sequence = Number(overrides.sequence ?? 1);
  const studentInitials = overrides.studentInitials ?? studentIdentityInitials(lastName, firstName);
  const studentCode =
    overrides.studentCode ??
    formatStudentCanonicalCode({
      countryCode: school.countryIso,
      schoolInitials: school.shortCode,
      studentInitials,
      year,
      sequence,
    });
  return {
    id: overrides.id ?? randomUUID(),
    schoolId: school.id,
    firstName,
    lastName,
    studentCode,
    publicId: studentCode,
    identifier: studentCode,
    school,
  };
}

module.exports = {
  createCanonicalSchool,
  createCanonicalUser,
  createCanonicalTeacher,
  createCanonicalStudent,
};
