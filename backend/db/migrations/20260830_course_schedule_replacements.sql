-- Planning V2 — remplacements ponctuels d'une occurrence weekly.
-- Ne modifie jamais school_courses.teacher_id ni course_schedule_weekly_slots.teacher_id.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS course_schedule_replacements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  weekly_slot_id UUID NOT NULL REFERENCES course_schedule_weekly_slots(id),
  occurrence_date DATE NOT NULL,
  original_teacher_id UUID NOT NULL REFERENCES teachers(id),
  substitute_teacher_id UUID NOT NULL REFERENCES teachers(id),
  reason TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_by UUID REFERENCES users(id),
  cancelled_by UUID REFERENCES users(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_minutes int4range GENERATED ALWAYS AS (
    int4range(
      (EXTRACT(HOUR FROM start_time)::integer * 60 + EXTRACT(MINUTE FROM start_time)::integer),
      (EXTRACT(HOUR FROM end_time)::integer * 60 + EXTRACT(MINUTE FROM end_time)::integer),
      '[)'
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_schedule_replacements_status_check
    CHECK (status IN ('planned', 'completed', 'cancelled')),
  CONSTRAINT course_schedule_replacements_teachers_distinct
    CHECK (original_teacher_id <> substitute_teacher_id),
  CONSTRAINT course_schedule_replacements_time_order CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_schedule_replacements_active_occurrence
  ON course_schedule_replacements (weekly_slot_id, occurrence_date)
  WHERE status IN ('planned', 'completed');

CREATE INDEX IF NOT EXISTS idx_course_schedule_replacements_school_date
  ON course_schedule_replacements (school_id, occurrence_date, status);

CREATE INDEX IF NOT EXISTS idx_course_schedule_replacements_substitute_date
  ON course_schedule_replacements (school_id, substitute_teacher_id, occurrence_date)
  WHERE status IN ('planned', 'completed');

CREATE OR REPLACE FUNCTION course_schedule_replacements_assert_coherence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  slot RECORD;
  year_row RECORD;
  substitute RECORD;
BEGIN
  SELECT w.school_id, w.academic_year_id, w.teacher_id, w.day_of_week, w.start_time, w.end_time, w.status
    INTO slot
  FROM course_schedule_weekly_slots w
  WHERE w.id = NEW.weekly_slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'weekly_slot_id introuvable'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.school_id := slot.school_id;
  NEW.academic_year_id := slot.academic_year_id;
  NEW.original_teacher_id := slot.teacher_id;
  NEW.start_time := slot.start_time;
  NEW.end_time := slot.end_time;

  IF slot.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'créneau hebdomadaire inactif'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXTRACT(ISODOW FROM NEW.occurrence_date)::integer IS DISTINCT FROM slot.day_of_week THEN
    RAISE EXCEPTION 'REPLACEMENT_WEEKDAY_MISMATCH'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT ay.start_date, ay.end_date, ay.school_id
    INTO year_row
  FROM academic_years ay
  WHERE ay.id = slot.academic_year_id;

  IF NOT FOUND OR year_row.school_id IS DISTINCT FROM slot.school_id THEN
    RAISE EXCEPTION 'année académique incohérente'
      USING ERRCODE = 'check_violation';
  END IF;
  IF year_row.start_date IS NOT NULL AND NEW.occurrence_date < year_row.start_date THEN
    RAISE EXCEPTION 'REPLACEMENT_DATE_OUT_OF_YEAR'
      USING ERRCODE = 'check_violation';
  END IF;
  IF year_row.end_date IS NOT NULL AND NEW.occurrence_date > year_row.end_date THEN
    RAISE EXCEPTION 'REPLACEMENT_DATE_OUT_OF_YEAR'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT t.id, t.school_id, t.status
    INTO substitute
  FROM teachers t
  WHERE t.id = NEW.substitute_teacher_id;

  IF NOT FOUND OR substitute.school_id IS DISTINCT FROM slot.school_id THEN
    RAISE EXCEPTION 'remplaçant hors établissement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF lower(substitute.status) IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'remplaçant inactif'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('planned', 'completed') THEN
    IF EXISTS (
      SELECT 1
      FROM course_schedule_weekly_slots w
      WHERE w.teacher_id = NEW.substitute_teacher_id
        AND w.school_id = NEW.school_id
        AND w.academic_year_id = NEW.academic_year_id
        AND w.status = 'active'
        AND w.day_of_week = slot.day_of_week
        AND w.start_time < NEW.end_time
        AND NEW.start_time < w.end_time
    ) THEN
      RAISE EXCEPTION 'SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_schedule_replacements_coherence ON course_schedule_replacements;
CREATE TRIGGER trg_course_schedule_replacements_coherence
  BEFORE INSERT OR UPDATE OF weekly_slot_id, occurrence_date, substitute_teacher_id, status, school_id, original_teacher_id
  ON course_schedule_replacements
  FOR EACH ROW
  EXECUTE FUNCTION course_schedule_replacements_assert_coherence();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_schedule_replacements_no_substitute_overlap'
  ) THEN
    ALTER TABLE course_schedule_replacements
      ADD CONSTRAINT course_schedule_replacements_no_substitute_overlap
      EXCLUDE USING gist (
        school_id WITH =,
        substitute_teacher_id WITH =,
        occurrence_date WITH =,
        slot_minutes WITH &&
      )
      WHERE (status IN ('planned', 'completed'));
  END IF;
END $$;
