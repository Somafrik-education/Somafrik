"use strict";

/**
 * LOT 5 — schéma PostgreSQL canonique pour la pédagogie (cours, emplois du temps).
 * Idempotent ; aucun backfill ni lecture de backoffice_state.
 *
 * Planning V2 : course_schedule_weekly_slots est l'autorité hebdomadaire.
 * course_schedule_slots reste pour les événements datés (examens / historique).
 */

const fs = require("node:fs");
const path = require("node:path");

const WEEKLY_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260828_course_schedule_weekly_canonical.sql"),
  "utf8",
);

const ROOMS_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260829_school_rooms_canonical.sql"),
  "utf8",
);

const REPLACEMENTS_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260830_course_schedule_replacements.sql"),
  "utf8",
);

const PEDAGOGY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS school_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  teacher_id UUID REFERENCES teachers(id),
  course_code TEXT NOT NULL,
  coefficient NUMERIC(8, 2) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  legacy_json_id TEXT,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_courses_coefficient_positive CHECK (coefficient > 0),
  CONSTRAINT school_courses_status_check CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_courses_school_code
  ON school_courses (school_id, course_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_courses_class_subject_active
  ON school_courses (school_id, class_id, subject_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_school_courses_school_updated_at_id
  ON school_courses (school_id, updated_at, id);

CREATE TABLE IF NOT EXISTS course_schedule_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  class_name TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  teacher_id UUID REFERENCES teachers(id),
  slot_kind TEXT NOT NULL DEFAULT 'course',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  room TEXT,
  exam_name TEXT,
  exam_type TEXT,
  exam_id UUID,
  period_name TEXT,
  period_start DATE,
  period_end DATE,
  legacy_json_id TEXT,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_schedule_slots_kind_check CHECK (slot_kind IN ('course', 'exam')),
  CONSTRAINT course_schedule_slots_time_order CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_schedule_slots_school_legacy
  ON course_schedule_slots (school_id, legacy_json_id)
  WHERE legacy_json_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_schedule_slots_school_class
  ON course_schedule_slots (school_id, class_name, starts_at);

DO $$
BEGIN
  IF to_regclass('public.course_schedule_slots') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM course_schedule_slots WHERE class_id IS NULL) THEN
      RAISE EXCEPTION 'course_schedule_slots contains NULL class_id rows; backfill required before NOT NULL enforcement';
    END IF;
    ALTER TABLE course_schedule_slots ALTER COLUMN class_id SET NOT NULL;
  END IF;
END $$;

${WEEKLY_SCHEMA_SQL}

${ROOMS_SCHEMA_SQL}

${REPLACEMENTS_SCHEMA_SQL}
`;

module.exports = { PEDAGOGY_SCHEMA_SQL, WEEKLY_SCHEMA_SQL, ROOMS_SCHEMA_SQL, REPLACEMENTS_SCHEMA_SQL };
