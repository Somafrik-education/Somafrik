"use strict";

/**
 * LOT 2 / PARITY-032 — schéma additif C18 sur `enrollments`.
 * Idempotent. Aucune table parallèle. Aucun DROP de lignes.
 */
const ENROLLMENT_C18_SCHEMA_SQL = `
DO $c18$class$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'enrollments'
       AND column_name = 'class_id'
       AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE enrollments ALTER COLUMN class_id DROP NOT NULL;
  END IF;
END
$c18$class$;

ALTER TABLE enrollments ALTER COLUMN status SET DEFAULT 'ENROLLED';

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS close_notes TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS transfer_destination TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS transfer_notes TEXT;

CREATE OR REPLACE FUNCTION student_fee_obligations_assert_active_enrollment_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  enrollment_class UUID;
BEGIN
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
     AND lower(btrim(e.status)) IN ('active', 'enrolled')
     AND lower(btrim(ay.name)) = lower(btrim(NEW.academic_year))
   ORDER BY e.enrollment_date DESC NULLS LAST, e.created_at DESC NULLS LAST
   LIMIT 1
   FOR UPDATE OF e;

  IF NOT FOUND THEN
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
`;

module.exports = { ENROLLMENT_C18_SCHEMA_SQL };
