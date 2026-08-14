-- Unicité des affectations ACTIVES uniquement (réaffectation après status='deleted').
-- Idempotente. Appliquée aussi au boot via PostgresRepository.ensureTeacherAssignmentsActiveUniqueness.
-- Interdit : suppression automatique de l'historique (lignes deleted conservées).

DO $$
DECLARE
  duplicate_groups integer := 0;
BEGIN
  SELECT COUNT(*)::int INTO duplicate_groups
  FROM (
    SELECT teacher_id, class_id, subject_id, academic_year_id, assignment_role
    FROM teacher_assignments
    WHERE COALESCE(status, 'active') = 'active'
    GROUP BY teacher_id, class_id, subject_id, academic_year_id, assignment_role
    HAVING COUNT(*) > 1
  ) d;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Affectations : % groupe(s) en doublon parmi les lignes actives. Résolution explicite requise avant création de l''index uq_teacher_assignments_active_tuple. Aucune suppression automatique de l''historique n''est effectuée.',
      duplicate_groups;
  END IF;
END $$;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = ANY (current_schemas(false))
      AND t.relname = 'teacher_assignments'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%teacher_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%class_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%subject_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%academic_year_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%assignment_role%'
  LOOP
    EXECUTE format('ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;

  FOR rec IN
    SELECT i.indexrelid::regclass AS indexreg
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = ANY (current_schemas(false))
      AND t.relname = 'teacher_assignments'
      AND i.indisunique
      AND NOT i.indisprimary
      AND pg_get_indexdef(i.indexrelid) ILIKE '%teacher_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%class_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%subject_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%academic_year_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%assignment_role%'
      AND pg_get_indexdef(i.indexrelid) NOT ILIKE '%WHERE%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', rec.indexreg);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_assignments_active_tuple
  ON teacher_assignments (teacher_id, class_id, subject_id, academic_year_id, assignment_role)
  WHERE COALESCE(status, 'active') = 'active';
