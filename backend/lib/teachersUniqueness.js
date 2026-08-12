"use strict";

/**
 * Unicité atomique Teachers (établissement + compte utilisateur).
 * Index partiel + inventaire fail-safe avant création.
 *
 * Politique legacy : jamais de suppression silencieuse des doublons.
 * En présence de collisions, le boot/migration échoue avec un diagnostic précis.
 */

const TEACHERS_SCHOOL_USER_UNIQUE_INDEX = "teachers_school_user_unique";

/** Compte les groupes (school_id, user_id) en doublon (user_id non null). */
const COUNT_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, user_id
    FROM teachers
    WHERE user_id IS NOT NULL
    GROUP BY school_id, user_id
    HAVING COUNT(*) > 1
  ) d
`;

/** Échantillon diagnostic des groupes en doublon (résolution explicite requise). */
const LIST_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL = `
  SELECT
    s.school_code,
    t.user_id::text AS user_id,
    COUNT(*)::int AS duplicate_count,
    array_agg(t.teacher_code ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC) AS teacher_codes
  FROM teachers t
  JOIN schools s ON s.id = t.school_id
  WHERE t.user_id IS NOT NULL
  GROUP BY s.school_code, t.user_id
  HAVING COUNT(*) > 1
  ORDER BY s.school_code, t.user_id::text
  LIMIT 20
`;

const CREATE_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX}
  ON teachers (school_id, user_id)
  WHERE user_id IS NOT NULL
`;

/**
 * @param {Array<{
 *   school_code?: string,
 *   user_id?: string,
 *   duplicate_count?: number,
 *   teacher_codes?: string[] | string,
 * }>} groups
 * @param {number} duplicateGroups
 * @returns {string}
 */
function formatTeachersSchoolUserDuplicateDiagnostic(groups = [], duplicateGroups = 0) {
  const samples = (Array.isArray(groups) ? groups : [])
    .slice(0, 10)
    .map((row) => {
      const codes = Array.isArray(row.teacher_codes)
        ? row.teacher_codes.join(",")
        : String(row.teacher_codes ?? "");
      return `${row.school_code}/user=${row.user_id}×${row.duplicate_count}[${codes}]`;
    })
    .join("; ");
  return (
    `Teachers : ${duplicateGroups} groupe(s) en doublon (school_id, user_id). ` +
    `Résolution explicite requise avant création de l'index ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX}. ` +
    `Aucune suppression automatique n'est effectuée. ` +
    (samples ? `Exemples: ${samples}` : "Aucun détail disponible.")
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTeachersSchoolUserUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") {
    return false;
  }
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  const message = String(error.message ?? "");
  return (
    constraint === TEACHERS_SCHOOL_USER_UNIQUE_INDEX ||
    detail.includes(TEACHERS_SCHOOL_USER_UNIQUE_INDEX) ||
    message.includes(TEACHERS_SCHOOL_USER_UNIQUE_INDEX) ||
    /Key \(school_id, user_id\)/i.test(detail)
  );
}

module.exports = {
  TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
  COUNT_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL,
  LIST_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL,
  CREATE_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL,
  formatTeachersSchoolUserDuplicateDiagnostic,
  isTeachersSchoolUserUniquenessViolation,
};
