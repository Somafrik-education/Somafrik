-- Planning V2 — révision monotone pour TEACHER_REPLACEMENT (bootstrap Pédagogie + migration L5).
-- Source unique : importé par pedagogySchema.js ; recopié idempotent dans 20260918.

ALTER TABLE course_schedule_replacements
  ADD COLUMN IF NOT EXISTS change_revision BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION course_schedule_replacements_bump_change_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF lower(trim(COALESCE(NEW.status, ''))) = 'planned' THEN
      NEW.change_revision := 1;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF lower(trim(COALESCE(OLD.status, ''))) = 'planned'
       AND lower(trim(COALESCE(NEW.status, ''))) = 'cancelled' THEN
      NEW.change_revision := COALESCE(OLD.change_revision, 0) + 1;
    ELSIF lower(trim(COALESCE(OLD.status, ''))) = 'planned'
       AND lower(trim(COALESCE(NEW.status, ''))) = 'planned'
       AND OLD.substitute_teacher_id IS DISTINCT FROM NEW.substitute_teacher_id THEN
      NEW.change_revision := COALESCE(OLD.change_revision, 0) + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_schedule_replacements_bump_revision ON course_schedule_replacements;
CREATE TRIGGER trg_course_schedule_replacements_bump_revision
  BEFORE INSERT OR UPDATE OF substitute_teacher_id, status
  ON course_schedule_replacements
  FOR EACH ROW
  EXECUTE FUNCTION course_schedule_replacements_bump_change_revision();
