"use strict";

const IDENTITY_SEQUENCE_MAX = 99_999;

const ACCENTED = "ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝŸýÿŒœÆæ";
const ASCII =    "AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYYyyOoAa";

function asciiUpper(value) {
  const table = new Map([...ACCENTED].map((char, index) => [char, ASCII[index] ?? char]));
  return [...String(value ?? "")]
    .map((char) => table.get(char) ?? char)
    .join("")
    .toUpperCase();
}

function identityInitials(firstName, lastName) {
  const tokens = asciiUpper(`${firstName ?? ""} ${lastName ?? ""}`)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = tokens.map((token) => token[0]).join("").slice(0, 5);
  if (!initials) {
    const error = new Error("IDENTITY_INITIALS_REQUIRED: prénom/nom insuffisants");
    error.code = "IDENTITY_INITIALS_REQUIRED";
    throw error;
  }
  return initials;
}

function normalizeSchoolShortCode(value) {
  const normalized = asciiUpper(value).replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (normalized.length < 2) {
    const error = new Error("SCHOOL_SHORT_CODE_INVALID");
    error.code = "SCHOOL_SHORT_CODE_INVALID";
    throw error;
  }
  return normalized;
}

function schoolShortCodeFromName(name) {
  const tokens = asciiUpper(name)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let shortCode = tokens.map((token) => token[0]).join("").slice(0, 5);
  if (shortCode.length < 2) {
    shortCode = tokens.join("").slice(0, 5);
  }
  return normalizeSchoolShortCode(shortCode);
}

function identityYearShort(year) {
  const numeric = Number(year);
  if (!Number.isInteger(numeric) || numeric < 2000 || numeric > 9999) {
    const error = new Error("IDENTITY_YEAR_INVALID");
    error.code = "IDENTITY_YEAR_INVALID";
    throw error;
  }
  return String(numeric % 100).padStart(2, "0");
}

function assertSequence(sequence) {
  const numeric = Number(sequence);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > IDENTITY_SEQUENCE_MAX) {
    const error = new Error("IDENTITY_SEQUENCE_EXHAUSTED");
    error.code = "IDENTITY_SEQUENCE_EXHAUSTED";
    throw error;
  }
  return numeric;
}

function formatLoginCode({ initials, year, sequence }) {
  const normalizedInitials = asciiUpper(initials).replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (!normalizedInitials) {
    const error = new Error("IDENTITY_INITIALS_REQUIRED");
    error.code = "IDENTITY_INITIALS_REQUIRED";
    throw error;
  }
  return `${normalizedInitials}-${identityYearShort(year)}-${String(assertSequence(sequence)).padStart(5, "0")}`;
}

function formatIdentityCode({ countryCode, schoolShortCode, initials, year, sequence }) {
  const country = asciiUpper(countryCode).replace(/[^A-Z]/g, "");
  if (country.length !== 2) {
    const error = new Error("COUNTRY_CODE_INVALID");
    error.code = "COUNTRY_CODE_INVALID";
    throw error;
  }
  return `${country}-${normalizeSchoolShortCode(schoolShortCode)}-${formatLoginCode({ initials, year, sequence })}`;
}

module.exports = {
  IDENTITY_SEQUENCE_MAX,
  asciiUpper,
  identityInitials,
  normalizeSchoolShortCode,
  schoolShortCodeFromName,
  identityYearShort,
  formatLoginCode,
  formatIdentityCode,
};
