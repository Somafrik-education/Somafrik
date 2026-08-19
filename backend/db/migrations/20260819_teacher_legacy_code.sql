-- P0 teacher/course canonical reconcile : alias login temporaire ENS-####.
-- Idempotent. Aucune destruction. UUID teachers.id inchangé.

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS legacy_teacher_code VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_teachers_school_legacy_code
  ON teachers (school_id, legacy_teacher_code)
  WHERE legacy_teacher_code IS NOT NULL;
