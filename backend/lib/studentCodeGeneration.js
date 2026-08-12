"use strict";

const STUDENT_PROFILE = "ELE";
const SCHOOL_YEAR_BASE = 2025;

/**
 * Aligné sur web/src/lib/entityIdentifiers.ts — matricule ELE-pays-établissement-année-séquence.
 * Le code pays évite les collisions globales (CD-2026-0001 vs BI-2026-0001).
 * @param {string} schoolCode
 * @returns {{ country: string, year: string, establishment: string, yearIndex: string }}
 */
function parseSchoolCodeSegments(schoolCode) {
  const normalized = String(schoolCode ?? "")
    .trim()
    .toUpperCase();
  const match = /^([A-Z]{2})-(\d{4})-(\d{4})$/.exec(normalized);
  if (match) {
    const country = match[1];
    const year = match[2];
    const establishment = match[3];
    const yearIndex = Math.max(1, Number.parseInt(year, 10) - SCHOOL_YEAR_BASE);
    return {
      country,
      year,
      establishment,
      yearIndex: String(yearIndex).padStart(4, "0"),
    };
  }
  const digits = normalized.replace(/\D/g, "");
  return {
    country: "",
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
  if (segments.country) {
    return `${STUDENT_PROFILE}-${segments.country}-${segments.establishment}-${segments.yearIndex}-`;
  }
  return `${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-`;
}

/**
 * @param {string} schoolCode
 * @param {number} sequence
 * @returns {string}
 */
function formatStudentCode(schoolCode, sequence) {
  const segments = parseSchoolCodeSegments(schoolCode);
  const suffix = String(sequence).padStart(6, "0");
  if (segments.country) {
    return `${STUDENT_PROFILE}-${segments.country}-${segments.establishment}-${segments.yearIndex}-${suffix}`;
  }
  return `${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-${suffix}`;
}

/**
 * @param {string} studentCode
 * @param {string} schoolCode
 * @returns {number | null}
 */
function extractStudentSequence(studentCode, schoolCode) {
  const segments = parseSchoolCodeSegments(schoolCode);
  const normalized = String(studentCode ?? "").trim().toUpperCase();

  if (segments.country) {
    const withCountry = new RegExp(
      `^${STUDENT_PROFILE}-${segments.country}-${segments.establishment}-${segments.yearIndex}-(\\d+)$`,
      "i",
    );
    const countryMatch = withCountry.exec(normalized);
    if (countryMatch?.[1]) {
      const value = Number(countryMatch[1]);
      return Number.isFinite(value) ? value : null;
    }
  }

  // Ancien format sans pays (ELE-0001-0001-000001) — pour poursuivre la séquence locale.
  const legacy = new RegExp(
    `^${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-(\\d+)$`,
    "i",
  );
  const legacyMatch = legacy.exec(normalized);
  if (!legacyMatch?.[1]) return null;
  const value = Number(legacyMatch[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Prochain matricule élève pour un établissement (globalement unique via préfixe pays).
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
