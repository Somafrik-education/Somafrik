-- Planning V2 — salles canoniques + collision room_id sur le weekly slot.
-- room TEXT historique reste pour compatibilité ; room_id est l'autorité V2.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS school_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  room_code TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER,
  room_type TEXT,
  building TEXT,
  floor TEXT,
  equipment JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_rooms_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT school_rooms_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT school_rooms_code_format CHECK (room_code ~ '^SAL-[0-9]{4}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_rooms_school_code
  ON school_rooms (school_id, room_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_rooms_school_name_active
  ON school_rooms (school_id, lower(btrim(name)))
  WHERE status IN ('active', 'inactive');

CREATE INDEX IF NOT EXISTS idx_school_rooms_school_status
  ON school_rooms (school_id, status);

ALTER TABLE course_schedule_weekly_slots
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES school_rooms(id);

CREATE INDEX IF NOT EXISTS idx_course_schedule_weekly_room_day
  ON course_schedule_weekly_slots (school_id, academic_year_id, room_id, day_of_week)
  WHERE room_id IS NOT NULL AND status = 'active';

CREATE OR REPLACE FUNCTION course_schedule_weekly_slots_assert_room_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  room_school UUID;
BEGIN
  IF NEW.room_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT school_id INTO room_school FROM school_rooms WHERE id = NEW.room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_id introuvable'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF room_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'salle hors établissement'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_schedule_weekly_slots_room_tenant ON course_schedule_weekly_slots;
CREATE TRIGGER trg_course_schedule_weekly_slots_room_tenant
  BEFORE INSERT OR UPDATE OF school_id, room_id
  ON course_schedule_weekly_slots
  FOR EACH ROW
  EXECUTE FUNCTION course_schedule_weekly_slots_assert_room_tenant();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_schedule_weekly_slots_no_room_overlap'
  ) THEN
    ALTER TABLE course_schedule_weekly_slots
      ADD CONSTRAINT course_schedule_weekly_slots_no_room_overlap
      EXCLUDE USING gist (
        school_id WITH =,
        academic_year_id WITH =,
        room_id WITH =,
        day_of_week WITH =,
        slot_minutes WITH &&
      )
      WHERE (status = 'active' AND room_id IS NOT NULL);
  END IF;
END $$;
