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
const { formatSchoolLoginCode } = require("./schoolCodeV2");
const {
  formatStudentCanonicalCode,
  studentIdentityInitials,
} = require("./studentCanonicalIdentifier");

function createCanonicalSchool(overrides = {}) {
  const countryIso = String(overrides.countryIso ?? "CD").trim().toUpperCase();
  const name = String(overrides.name ?? "Institut Nuru").trim();
  const year = Number(overrides.year ?? 2026);
  const sequence = Number(overrides.sequence ?? 1);
  const loginCode =
    overrides.loginCode ?? formatSchoolLoginCode({ countryIso, schoolName: name, year, sequence });
  return {
    id: overrides.id ?? randomUUID(),
    countryIso,
    name,
    loginCode,
    shortCode: overrides.shortCode ?? schoolShortCodeFromName(name),
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
