"use strict";

/**
 * LOT 2 — Clôture reconstruction Élèves.
 * Les écritures legacy via PUT /api/backoffice/state sont interdites.
 * Les élèves sont gérés exclusivement via les APIs PostgreSQL /api/students
 * et /api/classes/:classCode/students. state.students reste une projection
 * de lecture.
 */

const LEGACY_STUDENTS_STATE_WRITE_CODE = "LEGACY_STUDENTS_STATE_WRITE_FORBIDDEN";
const LEGACY_STUDENTS_STATE_WRITE_MESSAGE =
  "Les élèves ne sont plus modifiables via /api/backoffice/state. Utilisez /api/students et /api/classes/:classCode/students.";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Toute présence de la clé students est un rejet stable, quelle que soit sa
 * valeur (tableau vide, null, undefined, snapshot ou PUT mixte).
 *
 * @param {object} rawBody
 * @returns {{ body: object, rejectLegacyStudentsWrite: boolean, strippedStudents: boolean }}
 */
function stripLegacyStudentsStateWrite(rawBody = {}) {
  if (!isPlainObject(rawBody) || !Object.prototype.hasOwnProperty.call(rawBody, "students")) {
    return { body: rawBody, rejectLegacyStudentsWrite: false, strippedStudents: false };
  }

  const { students: _ignored, ...rest } = rawBody;
  return {
    body: rest,
    rejectLegacyStudentsWrite: true,
    strippedStudents: true,
  };
}

module.exports = {
  LEGACY_STUDENTS_STATE_WRITE_CODE,
  LEGACY_STUDENTS_STATE_WRITE_MESSAGE,
  stripLegacyStudentsStateWrite,
};
