-- F3 — identité canonique des obligations (additif, non destructif).
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS class_effective_date DATE;
UPDATE enrollments
   SET class_effective_date = COALESCE(class_effective_date, enrollment_date, CURRENT_DATE)
 WHERE class_effective_date IS NULL;

ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS fee_type_code TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS period_key TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS source_enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL;
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
