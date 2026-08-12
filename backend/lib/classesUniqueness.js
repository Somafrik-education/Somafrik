"use strict";

/**
 * Unicité atomique Classes (établissement + année + nom normalisé).
 * Index expressionnel + classification des violations PostgreSQL 23505.
 *
 * Politique legacy fail-safe : jamais de suppression silencieuse des doublons.
 * En présence de collisions, le boot/migration échoue avec un diagnostic précis.
 */

const CLASSES_NAME_UNIQUE_INDEX = "uq_classes_school_year_normalized_name";
const CLASSES_STATUS_CHECK = "classes_status_check";
const CLASSES_CLASS_CODE_UNIQUE = "classes_class_code_key";

/** Compte les groupes (school_id, academic_year_id, nom normalisé) en doublon. */
const COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, academic_year_id, lower(btrim(name)) AS normalized_name
    FROM classes
    GROUP BY school_id, academic_year_id, lower(btrim(name))
    HAVING COUNT(*) > 1
  ) d
`;

/** Échantillon diagnostic des groupes en doublon (résolution explicite requise). */
const LIST_CLASSES_NAME_DUPLICATE_GROUPS_SQL = `
  SELECT
    s.school_code,
    ay.name AS academic_year_name,
    lower(btrim(cl.name)) AS normalized_name,
    COUNT(*)::int AS duplicate_count,
    array_agg(cl.class_code ORDER BY cl.updated_at DESC NULLS LAST, cl.created_at DESC NULLS LAST, cl.id DESC) AS class_codes
  FROM classes cl
  JOIN schools s ON s.id = cl.school_id
  JOIN academic_years ay ON ay.id = cl.academic_year_id
  GROUP BY s.school_code, ay.name, lower(btrim(cl.name))
  HAVING COUNT(*) > 1
  ORDER BY s.school_code, ay.name, normalized_name
  LIMIT 20
`;

const CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${CLASSES_NAME_UNIQUE_INDEX}
  ON classes (school_id, academic_year_id, (lower(btrim(name))))
`;

const ENSURE_CLASSES_STATUS_CHECK_SQL = `
DO $$ BEGIN
  ALTER TABLE classes
    ADD CONSTRAINT ${CLASSES_STATUS_CHECK}
    CHECK (status IN ('active', 'inactive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$
`;

const NORMALIZE_CLASSES_STATUS_SQL = `
UPDATE classes
SET status = CASE
  WHEN lower(btrim(status)) IN ('active', 'actif') THEN 'active'
  WHEN lower(btrim(status)) IN ('inactive', 'inactif', 'archived', 'archivée', 'archivee') THEN 'inactive'
  ELSE 'inactive'
END
WHERE status IS NULL
   OR status NOT IN ('active', 'inactive')
`;

/**
 * @param {Array<{
 *   school_code?: string,
 *   academic_year_name?: string,
 *   normalized_name?: string,
 *   duplicate_count?: number,
 *   class_codes?: string[] | string,
 * }>} groups
 * @param {number} duplicateGroups
 * @returns {string}
 */
function formatClassesNameDuplicateDiagnostic(groups = [], duplicateGroups = 0) {
  const samples = (Array.isArray(groups) ? groups : [])
    .slice(0, 10)
    .map((row) => {
      const codes = Array.isArray(row.class_codes)
        ? row.class_codes.join(",")
        : String(row.class_codes ?? "");
      return `${row.school_code}/${row.academic_year_name}/${row.normalized_name}×${row.duplicate_count}[${codes}]`;
    })
    .join("; ");
  return (
    `Classes : ${duplicateGroups} groupe(s) en doublon de nom normalisé ` +
    `(école + année + lower(btrim(name))). ` +
    `Résolution explicite requise avant création de l'index ${CLASSES_NAME_UNIQUE_INDEX}. ` +
    `Aucune suppression automatique n'est effectuée. ` +
    (samples ? `Exemples: ${samples}` : "Aucun détail disponible.")
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isClassNameUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") {
    return false;
  }
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  const message = String(error.message ?? "");
  return (
    constraint === CLASSES_NAME_UNIQUE_INDEX ||
    detail.includes(CLASSES_NAME_UNIQUE_INDEX) ||
    message.includes(CLASSES_NAME_UNIQUE_INDEX) ||
    /lower\(btrim\(name\)\)/i.test(detail) ||
    /Key \(school_id, academic_year_id,/i.test(detail)
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isClassCodeUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") {
    return false;
  }
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  return (
    constraint === CLASSES_CLASS_CODE_UNIQUE ||
    /Key \(class_code\)=/i.test(detail) ||
    /unique constraint .*class_code/i.test(String(error.message ?? ""))
  );
}

module.exports = {
  CLASSES_NAME_UNIQUE_INDEX,
  CLASSES_STATUS_CHECK,
  CLASSES_CLASS_CODE_UNIQUE,
  COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL,
  LIST_CLASSES_NAME_DUPLICATE_GROUPS_SQL,
  CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
  ENSURE_CLASSES_STATUS_CHECK_SQL,
  NORMALIZE_CLASSES_STATUS_SQL,
  formatClassesNameDuplicateDiagnostic,
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
};
