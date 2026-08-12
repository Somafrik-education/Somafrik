"use strict";

const STUDENT_PROFILE = "ELE";
const SCHOOL_YEAR_BASE = 2025;

/**
 * Aligné sur web/src/lib/entityIdentifiers.ts — matricule ELE-établissement-année-séquence.
 * @param {string} schoolCode
 * @returns {{ year: string, establishment: string, yearIndex: string }}
 */
function parseSchoolCodeSegments(schoolCode) {
  const normalized = String(schoolCode ?? "")
    .trim()
    .toUpperCase();
  const match = /^[A-Z]{2}-(\d{4})-(\d{4})$/.exec(normalized);
  if (match) {
    const year = match[1];
    const establishment = match[2];
    const yearIndex = Math.max(1, Number.parseInt(year, 10) - SCHOOL_YEAR_BASE);
    return {
      year,
      establishment,
      yearIndex: String(yearIndex).padStart(4, "0"),
    };
  }
  const digits = normalized.replace(/\D/g, "");
  return {
    year: (digits.slice(0, 4) || "0000").padStart(4, "0").slice(-4),
    establishment: (digits.slice(-4) || "0000").padStart(4, "0"),
    yearIndex: "0001",
  };
}

/**
 * @param {string} schoolCode
 * @returns {string}
 */
function studentCodePrefix(schoolCode) {
  const segments = parseSchoolCodeSegments(schoolCode);
  return `${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-`;
}

/**
 * @param {string} schoolCode
 * @param {number} sequence
 * @returns {string}
 */
function formatStudentCode(schoolCode, sequence) {
  const segments = parseSchoolCodeSegments(schoolCode);
  return `${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-${String(sequence).padStart(6, "0")}`;
}

/**
 * @param {string} studentCode
 * @param {string} schoolCode
 * @returns {number | null}
 */
function extractStudentSequence(studentCode, schoolCode) {
  const segments = parseSchoolCodeSegments(schoolCode);
  const normalized = String(studentCode ?? "").trim().toUpperCase();
  const fullPattern = new RegExp(
    `^${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-(\\d+)$`,
    "i",
  );
  const match = fullPattern.exec(normalized);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Prochain matricule élève pour un établissement (globalement unique via suffixe établissement).
 * @param {string} schoolCode
 * @param {string[]} existingCodes
 * @returns {string}
 */
function generateNextStudentCode(schoolCode, existingCodes = []) {
  let max = 0;
  for (const code of existingCodes) {
    const sequence = extractStudentSequence(code, schoolCode);
    if (sequence != null) {
      max = Math.max(max, sequence);
    }
  }
  return formatStudentCode(schoolCode, max + 1);
}

module.exports = {
  STUDENT_PROFILE,
  SCHOOL_YEAR_BASE,
  parseSchoolCodeSegments,
  studentCodePrefix,
  formatStudentCode,
  extractStudentSequence,
  generateNextStudentCode,
};
