"use strict";

/**
 * Clôture reconstruction Classes — écritures legacy via PUT /api/backoffice/state.
 * Les classes se gèrent exclusivement via /api/classes (PostgreSQL).
 * state.classes reste une projection de lecture.
 */

const LEGACY_CLASSES_STATE_WRITE_CODE = "LEGACY_CLASSES_STATE_WRITE_FORBIDDEN";
const LEGACY_CLASSES_STATE_WRITE_MESSAGE =
  "Les classes ne sont plus modifiables via /api/backoffice/state. Utilisez GET/POST/PATCH /api/classes.";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Retire `classes` du corps pour ne jamais appliquer de mutation legacy.
 * Si la requête ne touche que `classes`, signaler un rejet explicite.
 *
 * @param {object} rawBody
 * @param {string[]} [knownEntityKeys]
 * @returns {{
 *   body: object,
 *   rejectLegacyClassesWrite: boolean,
 *   strippedClasses: boolean,
 * }}
 */
function stripLegacyClassesStateWrite(rawBody = {}, knownEntityKeys = []) {
  if (!isPlainObject(rawBody) || !Object.prototype.hasOwnProperty.call(rawBody, "classes")) {
    return { body: rawBody, rejectLegacyClassesWrite: false, strippedClasses: false };
  }

  const { classes: _ignored, ...rest } = rawBody;
  const entityKeys = Array.isArray(knownEntityKeys) ? knownEntityKeys : [];
  const otherTouched = entityKeys.filter(
    (key) => key !== "classes" && Object.prototype.hasOwnProperty.call(rest, key),
  );
  const optionalTouched = ["rolePermissions", "academicConfigs", "dashboardChartConfig", "auditLog"].filter(
    (key) => Object.prototype.hasOwnProperty.call(rest, key),
  );

  return {
    body: rest,
    rejectLegacyClassesWrite: otherTouched.length === 0 && optionalTouched.length === 0,
    strippedClasses: true,
  };
}

module.exports = {
  LEGACY_CLASSES_STATE_WRITE_CODE,
  LEGACY_CLASSES_STATE_WRITE_MESSAGE,
  stripLegacyClassesStateWrite,
};
