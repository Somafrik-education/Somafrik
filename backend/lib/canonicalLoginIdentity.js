"use strict";

/**
 * Auth V2 — un login métier canonique. Les anciens identifiants sont refusés.
 * Email et téléphone restent des facteurs Auth, pas des alias d'identité.
 */

const { isLegacySchoolCodeFormat, isV2SchoolLoginCode, normalizeSchoolCode } = require("./schoolCodeV2");
const { isPersonIdentityCode, normalizeIdentityCode } = require("./teacherCodeAllocation");

const SHORT_TEACHER_LOGIN_RE = /^ENS-\d+$/i;
const COMPOSITE_LEGACY_TEACHER_RE = /^[A-Z]{2}-20\d{2}-\d{4}-ENS-\d+$/i;

function isLegacyShortTeacherLogin(value) {
  return SHORT_TEACHER_LOGIN_RE.test(String(value ?? "").trim());
}

function isLegacyCompositeTeacherCode(value) {
  return COMPOSITE_LEGACY_TEACHER_RE.test(normalizeIdentityCode(value));
}

function isForbiddenLegacyLoginIdentifier(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return (
    isLegacyShortTeacherLogin(text) ||
    isLegacyCompositeTeacherCode(text) ||
    isLegacySchoolCodeFormat(text)
  );
}

function assertCanonicalLoginIdentifier(value) {
  if (isForbiddenLegacyLoginIdentifier(value)) {
    const error = new Error("Identifiant de connexion legacy refusé.");
    error.code = "LOGIN_IDENTIFIER_LEGACY_FORBIDDEN";
    error.statusCode = 401;
    throw error;
  }
}

function assertCanonicalSchoolLoginCode(value, { required = false } = {}) {
  const normalized = normalizeSchoolCode(value);
  if (!normalized) {
    if (required) {
      const error = new Error("Code établissement requis.");
      error.code = "SCHOOL_CODE_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    return "";
  }
  if (isLegacySchoolCodeFormat(normalized)) {
    const error = new Error("Ancien code établissement refusé.");
    error.code = "SCHOOL_CODE_LEGACY_FORBIDDEN";
    error.statusCode = 401;
    throw error;
  }
  if (!isV2SchoolLoginCode(normalized)) {
    const error = new Error("Code établissement invalide.");
    error.code = "SCHOOL_CODE_INVALID";
    error.statusCode = 401;
    throw error;
  }
  return normalized;
}

module.exports = {
  SHORT_TEACHER_LOGIN_RE,
  isLegacyShortTeacherLogin,
  isLegacyCompositeTeacherCode,
  isForbiddenLegacyLoginIdentifier,
  assertCanonicalLoginIdentifier,
  assertCanonicalSchoolLoginCode,
  isPersonIdentityCode,
};
