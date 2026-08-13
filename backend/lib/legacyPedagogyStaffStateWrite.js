"use strict";

/**
 * LOT 3 — clôture des writers legacy Enseignants / Affectations.
 * La présence de l'une de ces clés dans PUT /api/backoffice/state est rejetée,
 * quelle que soit sa valeur. Les projections restent lisibles dans state.
 */

const LEGACY_TEACHERS_STATE_WRITE_CODE = "LEGACY_TEACHERS_STATE_WRITE_FORBIDDEN";
const LEGACY_TEACHERS_STATE_WRITE_MESSAGE =
  "Les enseignants ne sont plus modifiables via /api/backoffice/state. Utilisez /api/teachers.";
const LEGACY_ASSIGNMENTS_STATE_WRITE_CODE = "LEGACY_ASSIGNMENTS_STATE_WRITE_FORBIDDEN";
const LEGACY_ASSIGNMENTS_STATE_WRITE_MESSAGE =
  "Les affectations ne sont plus modifiables via /api/backoffice/state. Utilisez /api/assignments.";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripLegacyPedagogyStaffStateWrite(rawBody = {}) {
  if (!isPlainObject(rawBody)) {
    return {
      body: rawBody,
      rejectedEntity: null,
      code: null,
      message: null,
    };
  }

  const hasTeachers = Object.prototype.hasOwnProperty.call(rawBody, "teachers");
  const hasAssignments = Object.prototype.hasOwnProperty.call(rawBody, "assignments");
  if (!hasTeachers && !hasAssignments) {
    return {
      body: rawBody,
      rejectedEntity: null,
      code: null,
      message: null,
    };
  }

  const { teachers: _teachers, assignments: _assignments, ...body } = rawBody;
  if (hasTeachers) {
    return {
      body,
      rejectedEntity: "teachers",
      code: LEGACY_TEACHERS_STATE_WRITE_CODE,
      message: LEGACY_TEACHERS_STATE_WRITE_MESSAGE,
    };
  }
  return {
    body,
    rejectedEntity: "assignments",
    code: LEGACY_ASSIGNMENTS_STATE_WRITE_CODE,
    message: LEGACY_ASSIGNMENTS_STATE_WRITE_MESSAGE,
  };
}

module.exports = {
  LEGACY_TEACHERS_STATE_WRITE_CODE,
  LEGACY_TEACHERS_STATE_WRITE_MESSAGE,
  LEGACY_ASSIGNMENTS_STATE_WRITE_CODE,
  LEGACY_ASSIGNMENTS_STATE_WRITE_MESSAGE,
  stripLegacyPedagogyStaffStateWrite,
};

