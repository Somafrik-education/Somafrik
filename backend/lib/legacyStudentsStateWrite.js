"use strict";

/**
 * Clôture reconstruction Élèves — écritures legacy via PUT /api/backoffice/state.
 * Les élèves se créent exclusivement via POST /api/classes/:classCode/students (PostgreSQL).
 * state.students reste une projection de lecture pour les modules non reconstruits.
 */

const LEGACY_STUDENTS_STATE_WRITE_CODE = "LEGACY_STUDENTS_STATE_WRITE_FORBIDDEN";
const LEGACY_STUDENTS_STATE_WRITE_MESSAGE =
  "Les élèves ne sont plus modifiables via /api/backoffice/state. Utilisez POST /api/classes/:classCode/students et PATCH /api/students/:id.";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Retire `students` du corps pour ne jamais appliquer de mutation legacy.
 * Si la requête ne touche que `students`, signaler un rejet explicite.
 *
 * @param {object} rawBody
 * @param {string[]} [knownEntityKeys]
 * @returns {{
 *   body: object,
 *   rejectLegacyStudentsWrite: boolean,
 *   strippedStudents: boolean,
 * }}
 */
function stripLegacyStudentsStateWrite(rawBody = {}, knownEntityKeys = []) {
  if (!isPlainObject(rawBody) || !Object.prototype.hasOwnProperty.call(rawBody, "students")) {
    return { body: rawBody, rejectLegacyStudentsWrite: false, strippedStudents: false };
  }

  const { students: _ignored, ...rest } = rawBody;
  const entityKeys = Array.isArray(knownEntityKeys) ? knownEntityKeys : [];
  const otherTouched = entityKeys.filter(
    (key) => key !== "students" && Object.prototype.hasOwnProperty.call(rest, key),
  );
  const optionalTouched = ["rolePermissions", "academicConfigs", "dashboardChartConfig", "auditLog"].filter(
    (key) => Object.prototype.hasOwnProperty.call(rest, key),
  );

  return {
    body: rest,
    rejectLegacyStudentsWrite: otherTouched.length === 0 && optionalTouched.length === 0,
    strippedStudents: true,
  };
}

module.exports = {
  LEGACY_STUDENTS_STATE_WRITE_CODE,
  LEGACY_STUDENTS_STATE_WRITE_MESSAGE,
  stripLegacyStudentsStateWrite,
};
