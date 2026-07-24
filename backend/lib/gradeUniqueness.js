/**
 * D3.6b — Unicité notes PG (école + évaluation + élève).
 *
 * Ordre obligatoire pour bases legacy :
 * 1. schéma non bloquant (sans index unique global)
 * 2. migration / rattachement evaluation_id
 * 3. déduplication déterministe
 * 4. création de l'index unique
 */

const { pickCanonicalGradeRow } = require("./gradesCanonical");

/** Compte les groupes (school_id, evaluation_id, student_id) ayant > 1 ligne (evaluation_id non null). */
const COUNT_GRADE_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, evaluation_id, student_id
    FROM grades
    WHERE evaluation_id IS NOT NULL
    GROUP BY school_id, evaluation_id, student_id
    HAVING COUNT(*) > 1
  ) d
`;

/**
 * Supprime les doublons en conservant :
 * version DESC, updated_at DESC, created_at DESC, id DESC.
 */
const DEDUP_GRADES_KEEP_LATEST_SQL = `
  DELETE FROM grades
  WHERE id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY school_id, evaluation_id, student_id
          ORDER BY
            COALESCE(version, 1) DESC,
            updated_at DESC NULLS LAST,
            created_at DESC NULLS LAST,
            id DESC
        ) AS row_number
      FROM grades
      WHERE evaluation_id IS NOT NULL
    ) ranked
    WHERE ranked.row_number > 1
  )
`;

const CREATE_GRADE_UNIQUE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_grades_school_evaluation_student
  ON grades (school_id, evaluation_id, student_id)
  WHERE evaluation_id IS NOT NULL
`;

const COUNT_GRADE_ANOMALIES_SQL = `
  SELECT COUNT(*)::int AS anomaly_count
  FROM grades
  WHERE evaluation_id IS NULL
`;

module.exports = {
  COUNT_GRADE_DUPLICATE_GROUPS_SQL,
  DEDUP_GRADES_KEEP_LATEST_SQL,
  CREATE_GRADE_UNIQUE_INDEX_SQL,
  COUNT_GRADE_ANOMALIES_SQL,
  pickCanonicalGradeRow,
};
