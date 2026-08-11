"use strict";

/**
 * Unicité atomique Classes (établissement + année + nom normalisé).
 * Index expressionnel + classification des violations PostgreSQL 23505.
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

/**
 * Supprime les doublons de nom en conservant la ligne la plus récente :
 * updated_at DESC, created_at DESC, id DESC.
 */
const DEDUP_CLASSES_NAME_KEEP_LATEST_SQL = `
  DELETE FROM classes
  WHERE id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY school_id, academic_year_id, lower(btrim(name))
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS row_number
      FROM classes
    ) ranked
    WHERE ranked.row_number > 1
  )
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
  DEDUP_CLASSES_NAME_KEEP_LATEST_SQL,
  CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
  ENSURE_CLASSES_STATUS_CHECK_SQL,
  NORMALIZE_CLASSES_STATUS_SQL,
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
};
