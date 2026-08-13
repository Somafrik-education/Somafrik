"use strict";

/**
 * LOT 5 — Clôture reconstruction Pédagogie.
 * Toute présence d'une clé pédagogique dans PUT /api/backoffice/state est rejetée
 * avant fusion, persistance ou effet secondaire (y compris [], {}, null, mixte).
 */

const LEGACY_PEDAGOGY_STATE_WRITE_CODE = "LEGACY_PEDAGOGY_STATE_WRITE_FORBIDDEN";
const LEGACY_PEDAGOGY_STATE_WRITE_MESSAGE =
  "Les données pédagogiques ne sont plus modifiables via /api/backoffice/state. Utilisez les APIs /api/courses, /api/course-schedules, /api/evaluations, /api/notes et /api/presences.";

const PEDAGOGY_STATE_KEYS = Object.freeze([
  "courseSchedules",
  "courses",
  "evaluations",
  "notes",
  "presences",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listRejectedPedagogyKeys(rawBody = {}) {
  if (!isPlainObject(rawBody)) return [];
  return PEDAGOGY_STATE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(rawBody, key));
}

/**
 * @param {object} rawBody
 * @returns {{
 *   body: object,
 *   rejectLegacyPedagogyWrite: boolean,
 *   rejectedKeys: string[],
 * }}
 */
function stripLegacyPedagogyStateWrite(rawBody = {}) {
  const rejectedKeys = listRejectedPedagogyKeys(rawBody);
  if (!rejectedKeys.length) {
    return { body: rawBody, rejectLegacyPedagogyWrite: false, rejectedKeys: [] };
  }

  const body = { ...rawBody };
  for (const key of rejectedKeys) {
    delete body[key];
  }
  return { body, rejectLegacyPedagogyWrite: true, rejectedKeys };
}

module.exports = {
  PEDAGOGY_STATE_KEYS,
  LEGACY_PEDAGOGY_STATE_WRITE_CODE,
  LEGACY_PEDAGOGY_STATE_WRITE_MESSAGE,
  listRejectedPedagogyKeys,
  stripLegacyPedagogyStateWrite,
};
