-- F3 — identité canonique des obligations (additif, non destructif).
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS class_effective_date DATE;
-- Copier uniquement enrollment_date connue. Jamais CURRENT_DATE : une date inventée
-- ne doit pas décider d'une annulation CLASS_TRANSFER.
UPDATE enrollments
   SET class_effective_date = enrollment_date
 WHERE class_effective_date IS NULL
   AND enrollment_date IS NOT NULL;

ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS fee_type_code TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS period_key TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS source_enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL;
-- Lignée UUID best-effort (NULL après replaceGridItems DELETE). Snapshot stable = school_fee_item_id.
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS source_fee_item_uuid UUID REFERENCES school_fee_items(id) ON DELETE SET NULL;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS student_fee_obligations_identity_uniq
  ON student_fee_obligations (
    school_id,
    student_id,
    (COALESCE(academic_year, '')),
    (COALESCE(fee_type_code, '')),
    (COALESCE(period_key, ''))
  )
  WHERE archived_at IS NULL
    AND period_key IS NOT NULL AND btrim(period_key) <> ''
    AND fee_type_code IS NOT NULL AND btrim(fee_type_code) <> '';

-- P1 F3 : sérialiser toute nouvelle dette class-scoped contre le transfert de classe.
-- Le verrou est pris au dernier point d'autorité PostgreSQL, juste avant l'INSERT/UPDATE
-- d'une obligation active. Ainsi un apply de grille ayant lu 6A avant un transfert 6A→6B
-- attend le transfert, revoit 6B après COMMIT et ne peut pas recréer une dette future 6A.
CREATE OR REPLACE FUNCTION student_fee_obligations_assert_active_enrollment_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  enrollment_class UUID;
BEGIN
  -- L'archivage/supersede historique reste autorisé. Les obligations school-wide explicites
  -- (class_id NULL) ne sont pas concernées par cette garde class-scoped.
  IF NEW.archived_at IS NOT NULL
     OR NEW.class_id IS NULL
     OR COALESCE(btrim(NEW.academic_year), '') = '' THEN
    RETURN NEW;
  END IF;

  SELECT e.class_id
    INTO enrollment_class
    FROM enrollments e
    JOIN academic_years ay ON ay.id = e.academic_year_id
   WHERE e.student_id = NEW.student_id
     AND e.school_id = NEW.school_id
     AND lower(btrim(e.status)) = 'active'
     AND lower(btrim(ay.name)) = lower(btrim(NEW.academic_year))
   ORDER BY e.enrollment_date DESC NULLS LAST, e.created_at DESC NULLS LAST
   LIMIT 1
   FOR UPDATE OF e;

  IF NOT FOUND THEN
    -- 23505 est volontaire : insertObligationIfAbsent traite cette écriture devenue
    -- obsolète comme un skip idempotent au lieu de fabriquer une dette sans inscription.
    RAISE EXCEPTION 'FINANCE_ENROLLMENT_NOT_FOUND'
      USING ERRCODE = '23505',
            CONSTRAINT = 'student_fee_obligations_active_enrollment_guard';
  END IF;

  IF enrollment_class IS DISTINCT FROM NEW.class_id THEN
    RAISE EXCEPTION 'FINANCE_CLASS_ENROLLMENT_MISMATCH'
      USING ERRCODE = '23505',
            CONSTRAINT = 'student_fee_obligations_active_enrollment_guard';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_fee_obligations_active_enrollment_scope ON student_fee_obligations;
CREATE TRIGGER trg_student_fee_obligations_active_enrollment_scope
  BEFORE INSERT OR UPDATE OF school_id, student_id, class_id, academic_year, archived_at
  ON student_fee_obligations
  FOR EACH ROW
  EXECUTE FUNCTION student_fee_obligations_assert_active_enrollment_scope();
