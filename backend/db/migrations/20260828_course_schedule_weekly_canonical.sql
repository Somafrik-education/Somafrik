-- Planning V2 — emploi du temps hebdomadaire canonique.
-- Cette migration CRÉE la table vide. Elle ne convertit AUCUNE ligne
-- course_schedule_slots. L'inventaire MIGRATABLE/AMBIGUOUS/ORPHAN/EXAM
-- est exécuté au boot (ensurePlanningWeeklyPreflight) et via
-- backend/scripts/inventory-planning-weekly-preflight.js — sans INSERT.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS course_schedule_weekly_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  school_course_id UUID NOT NULL REFERENCES school_courses(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  day_of_week SMALLINT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  room TEXT,
  slot_minutes int4range GENERATED ALWAYS AS (
    int4range(
      (EXTRACT(HOUR FROM start_time)::integer * 60 + EXTRACT(MINUTE FROM start_time)::integer),
      (EXTRACT(HOUR FROM end_time)::integer * 60 + EXTRACT(MINUTE FROM end_time)::integer),
      '[)'
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_schedule_weekly_slots_day_check CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT course_schedule_weekly_slots_time_order CHECK (end_time > start_time),
  CONSTRAINT course_schedule_weekly_slots_status_check CHECK (status IN ('active', 'cancelled', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_course_schedule_weekly_school_year
  ON course_schedule_weekly_slots (school_id, academic_year_id, status);

CREATE INDEX IF NOT EXISTS idx_course_schedule_weekly_course
  ON course_schedule_weekly_slots (school_course_id, status);

CREATE INDEX IF NOT EXISTS idx_course_schedule_weekly_class_day
  ON course_schedule_weekly_slots (school_id, academic_year_id, class_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_course_schedule_weekly_teacher_day
  ON course_schedule_weekly_slots (school_id, academic_year_id, teacher_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_course_schedule_weekly_school_updated_at_id
  ON course_schedule_weekly_slots (school_id, updated_at, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_schedule_weekly_slots_no_class_overlap'
  ) THEN
    ALTER TABLE course_schedule_weekly_slots
      ADD CONSTRAINT course_schedule_weekly_slots_no_class_overlap
      EXCLUDE USING gist (
        school_id WITH =,
        academic_year_id WITH =,
        class_id WITH =,
        day_of_week WITH =,
        slot_minutes WITH &&
      )
      WHERE (status = 'active');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_schedule_weekly_slots_no_teacher_overlap'
  ) THEN
    ALTER TABLE course_schedule_weekly_slots
      ADD CONSTRAINT course_schedule_weekly_slots_no_teacher_overlap
      EXCLUDE USING gist (
        school_id WITH =,
        academic_year_id WITH =,
        teacher_id WITH =,
        day_of_week WITH =,
        slot_minutes WITH &&
      )
      WHERE (status = 'active');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION course_schedule_weekly_slots_assert_course_coherence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  course RECORD;
BEGIN
  SELECT sc.school_id, sc.class_id, sc.teacher_id, sc.status, c.academic_year_id
    INTO course
  FROM school_courses sc
  JOIN classes c ON c.id = sc.class_id
  WHERE sc.id = NEW.school_course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'school_course_id introuvable'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF course.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'school_course hors établissement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF course.class_id IS DISTINCT FROM NEW.class_id THEN
    RAISE EXCEPTION 'class_id incohérent avec school_course'
      USING ERRCODE = 'check_violation';
  END IF;
  IF course.teacher_id IS NULL OR course.teacher_id IS DISTINCT FROM NEW.teacher_id THEN
    RAISE EXCEPTION 'teacher_id incohérent avec school_course'
      USING ERRCODE = 'check_violation';
  END IF;
  IF course.academic_year_id IS DISTINCT FROM NEW.academic_year_id THEN
    RAISE EXCEPTION 'academic_year_id incohérent avec la classe du cours'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_schedule_weekly_slots_coherence ON course_schedule_weekly_slots;
CREATE TRIGGER trg_course_schedule_weekly_slots_coherence
  BEFORE INSERT OR UPDATE OF school_id, academic_year_id, school_course_id, class_id, teacher_id
  ON course_schedule_weekly_slots
  FOR EACH ROW
  EXECUTE FUNCTION course_schedule_weekly_slots_assert_course_coherence();
