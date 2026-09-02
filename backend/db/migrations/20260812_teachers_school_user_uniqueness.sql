-- Unicité Teachers (school_id, user_id) — migration contrôlée.
-- Idempotente. Appliquée aussi au boot via PostgresRepository.ensureTeachersDomainConstraints.
-- Interdit : suppression automatique des fiches en doublon.

DO $$
DECLARE
  duplicate_groups integer := 0;
BEGIN
  SELECT COUNT(*)::int INTO duplicate_groups
  FROM (
    SELECT school_id, user_id
    FROM teachers
    WHERE user_id IS NOT NULL
    GROUP BY school_id, user_id
    HAVING COUNT(*) > 1
  ) d;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Teachers : % groupe(s) en doublon (school_id, user_id). Résolution explicite requise avant création de l''index teachers_school_user_unique. Aucune suppression automatique n''est effectuée.',
      duplicate_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS teachers_school_user_unique
  ON teachers (school_id, user_id)
  WHERE user_id IS NOT NULL;
