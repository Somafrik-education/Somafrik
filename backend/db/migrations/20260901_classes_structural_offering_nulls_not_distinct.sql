-- PR-1A — unicité structurelle NULL-safe (PostgreSQL 16).
-- Aucune écriture de lignes classes. Fail-closed si doublons sous la nouvelle règle.

DO $$
DECLARE
  dupes int;
BEGIN
  SELECT COUNT(*)::int INTO dupes
  FROM (
    SELECT 1
    FROM classes
    WHERE level_id IS NOT NULL
    GROUP BY school_id, academic_year_id, level_id, stream_id, group_id
    HAVING COUNT(*) > 1
  ) d;

  IF dupes > 0 THEN
    RAISE EXCEPTION
      'CLASSES_STRUCTURAL_NULL_DUPLICATES: % groupe(s) structurel(s) en doublon. Aucune correction automatique. STOP.',
      dupes;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_classes_structural_offering;

CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_structural_offering
  ON classes (school_id, academic_year_id, level_id, stream_id, group_id)
  NULLS NOT DISTINCT
  WHERE level_id IS NOT NULL;
