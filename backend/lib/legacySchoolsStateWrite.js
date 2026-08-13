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
 * Retire `schools` du corps pour ne jamais appliquer de mutation legacy.
 * Si la requête ne touche que `schools`, signaler un rejet explicite.
 *
 * @param {object} rawBody
 * @param {string[]} [knownEntityKeys]
 * @returns {{
 *   body: object,
 *   rejectLegacySchoolsWrite: boolean,
 *   strippedSchools: boolean,
 * }}
 */
function stripLegacySchoolsStateWrite(rawBody = {}, knownEntityKeys = []) {
  if (!isPlainObject(rawBody) || !Object.prototype.hasOwnProperty.call(rawBody, "schools")) {
    return { body: rawBody, rejectLegacySchoolsWrite: false, strippedSchools: false };
  }

  const { schools: _ignored, ...rest } = rawBody;
  const entityKeys = Array.isArray(knownEntityKeys) ? knownEntityKeys : [];
  const otherTouched = entityKeys.filter(
    (key) => key !== "schools" && Object.prototype.hasOwnProperty.call(rest, key),
  );
  const optionalTouched = ["rolePermissions", "academicConfigs", "dashboardChartConfig", "auditLog"].filter(
    (key) => Object.prototype.hasOwnProperty.call(rest, key),
  );

  return {
    body: rest,
    rejectLegacySchoolsWrite: otherTouched.length === 0 && optionalTouched.length === 0,
    strippedSchools: true,
  };
}

module.exports = {
  LEGACY_SCHOOLS_STATE_WRITE_CODE,
  LEGACY_SCHOOLS_STATE_WRITE_MESSAGE,
  stripLegacySchoolsStateWrite,
};
