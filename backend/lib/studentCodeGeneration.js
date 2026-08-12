"use strict";

const STUDENT_PROFILE = "ELE";

/**
 * @param {string} schoolCode
 * @returns {{ establishment: string, yearIndex: string }}
 */
function parseSchoolCodeSegments(schoolCode) {
  const normalized = String(schoolCode ?? "")
    .trim()
    .toUpperCase();
  const parts = normalized.split("-").filter(Boolean);
  return {
    establishment: (parts[0] ?? "0000").replace(/[^A-Z0-9]/g, "") || "0000",
    yearIndex: (parts[1] ?? "0000").replace(/[^A-Z0-9]/g, "") || "0000",
  };
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
 * @returns {number | null}
 */
function extractStudentSequence(studentCode) {
  const match = /^ELE-([A-Z0-9]+)-([A-Z0-9]+)-(\d+)$/i.exec(String(studentCode ?? "").trim());
  if (!match?.[3]) return null;
  const value = Number(match[3]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Prochain matricule élève pour un établissement (pattern ELE-XXXX-YYYY-NNNNNN).
 * @param {string} schoolCode
 * @param {string[]} existingCodes
 * @returns {string}
 */
function generateNextStudentCode(schoolCode, existingCodes = []) {
  const prefix = formatStudentCode(schoolCode, 0).replace(/0{6}$/, "");
  let max = 0;
  for (const code of existingCodes) {
    const normalized = String(code ?? "").trim().toUpperCase();
    if (!normalized.startsWith(prefix)) continue;
    const sequence = extractStudentSequence(normalized);
    if (sequence != null) {
      max = Math.max(max, sequence);
    }
  }
  return formatStudentCode(schoolCode, max + 1);
}

module.exports = {
  STUDENT_PROFILE,
  parseSchoolCodeSegments,
  formatStudentCode,
  extractStudentSequence,
  generateNextStudentCode,
};
