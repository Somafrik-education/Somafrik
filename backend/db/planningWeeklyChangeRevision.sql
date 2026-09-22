-- Planning V2 — révision monotone pour TIMETABLE_CHANGED (bootstrap Pédagogie + migration L4).
-- Source unique : importé par pedagogySchema.js ; recopié idempotent dans 20260917.

ALTER TABLE course_schedule_weekly_slots
  ADD COLUMN IF NOT EXISTS change_revision BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION course_schedule_weekly_slots_bump_change_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND lower(trim(COALESCE(OLD.status, ''))) = 'active' THEN
    IF (
      OLD.day_of_week IS DISTINCT FROM NEW.day_of_week
      OR OLD.start_time IS DISTINCT FROM NEW.start_time
      OR OLD.end_time IS DISTINCT FROM NEW.end_time
      OR OLD.room IS DISTINCT FROM NEW.room
      OR OLD.room_id IS DISTINCT FROM NEW.room_id
      OR OLD.school_course_id IS DISTINCT FROM NEW.school_course_id
      OR OLD.teacher_id IS DISTINCT FROM NEW.teacher_id
      OR OLD.class_id IS DISTINCT FROM NEW.class_id
      OR NEW.status IS DISTINCT FROM OLD.status
    ) THEN
      NEW.change_revision := COALESCE(OLD.change_revision, 0) + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_schedule_weekly_slots_bump_revision ON course_schedule_weekly_slots;
CREATE TRIGGER trg_course_schedule_weekly_slots_bump_revision
  BEFORE UPDATE OF day_of_week, start_time, end_time, room, room_id, school_course_id, teacher_id, class_id, status
  ON course_schedule_weekly_slots
  FOR EACH ROW
  EXECUTE FUNCTION course_schedule_weekly_slots_bump_change_revision();
