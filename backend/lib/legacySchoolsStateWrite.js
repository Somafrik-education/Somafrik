"use strict";

/**
 * LOT 1 — Clôture reconstruction Établissements.
 * Écritures legacy via PUT /api/backoffice/state interdites.
 * Les établissements se gèrent exclusivement via /api/backoffice/establishments (PostgreSQL).
 * state.schools reste une projection de lecture.
 */

const LEGACY_SCHOOLS_STATE_WRITE_CODE = "LEGACY_SCHOOLS_STATE_WRITE_FORBIDDEN";
const LEGACY_SCHOOLS_STATE_WRITE_MESSAGE =
  "Les établissements ne sont plus modifiables via /api/backoffice/state. Utilisez GET/POST/PATCH/DELETE /api/backoffice/establishments.";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Toute présence de la clé `schools` (seule, mixte ou snapshot complet) est un
 * rejet stable. Le corps est aussi dépourvu de `schools` pour qu'aucune
 * mutation d'établissements n'atteigne le merge si le garde HTTP est contourné.
 *
 * @param {object} rawBody
 * @param {string[]} [_knownEntityKeys]
 * @returns {{
 *   body: object,
 *   rejectLegacySchoolsWrite: boolean,
 *   strippedSchools: boolean,
 * }}
 */
function stripLegacySchoolsStateWrite(rawBody = {}, _knownEntityKeys = []) {
  if (!isPlainObject(rawBody) || !Object.prototype.hasOwnProperty.call(rawBody, "schools")) {
    return { body: rawBody, rejectLegacySchoolsWrite: false, strippedSchools: false };
  }

  const { schools: _ignored, ...rest } = rawBody;
  return {
    body: rest,
    rejectLegacySchoolsWrite: true,
    strippedSchools: true,
  };
}

module.exports = {
  LEGACY_SCHOOLS_STATE_WRITE_CODE,
  LEGACY_SCHOOLS_STATE_WRITE_MESSAGE,
  stripLegacySchoolsStateWrite,
};
