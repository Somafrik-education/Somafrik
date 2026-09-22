-- Lot L5 — TEACHER_REPLACEMENT : change_revision + producteur outbox planning.teacher.replacement
-- Idempotent : converge bootstrap Pédagogie + C4 vers le même schéma.

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

-- Lot L5 — producteur C4 dédié TEACHER_REPLACEMENT sur course_schedule_replacements.

CREATE OR REPLACE FUNCTION somafrik_enqueue_teacher_replacement_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event_type TEXT := 'planning.teacher.replacement';
  v_action TEXT;
  v_class_id UUID;
  v_should_emit BOOLEAN := FALSE;
  v_payload JSONB;
  v_event_key TEXT;
BEGIN
  SELECT w.class_id INTO v_class_id
  FROM course_schedule_weekly_slots w
  WHERE w.id = NEW.weekly_slot_id;

  IF TG_OP = 'INSERT' THEN
    IF lower(trim(COALESCE(NEW.status, ''))) = 'planned' THEN
      v_action := 'assigned';
      v_should_emit := TRUE;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF lower(trim(COALESCE(OLD.status, ''))) = 'planned'
       AND lower(trim(COALESCE(NEW.status, ''))) = 'cancelled' THEN
      v_action := 'cancelled';
      v_should_emit := TRUE;
    ELSIF lower(trim(COALESCE(OLD.status, ''))) = 'planned'
       AND lower(trim(COALESCE(NEW.status, ''))) = 'planned'
       AND OLD.substitute_teacher_id IS DISTINCT FROM NEW.substitute_teacher_id THEN
      v_action := 'reassigned';
      v_should_emit := TRUE;
    END IF;
  END IF;

  IF v_should_emit THEN
    v_payload := jsonb_build_object(
      'replacementId', NEW.id,
      'changeRevision', NEW.change_revision,
      'action', v_action,
      'weeklySlotId', NEW.weekly_slot_id,
      'classId', v_class_id,
      'academicYearId', NEW.academic_year_id,
      'occurrenceDate', NEW.occurrence_date::text,
      'originalTeacherId', NEW.original_teacher_id,
      'substituteTeacherId', CASE
        WHEN v_action = 'cancelled' THEN OLD.substitute_teacher_id
        ELSE NEW.substitute_teacher_id
      END,
      'previousSubstituteTeacherId', CASE
        WHEN v_action = 'reassigned' THEN OLD.substitute_teacher_id
        ELSE NULL
      END,
      'startTime', NEW.start_time::text,
      'endTime', NEW.end_time::text,
      'status', NEW.status
    );
    v_event_key := v_event_type || ':' || NEW.id::text || ':' || NEW.change_revision::text;

    INSERT INTO communication_event_outbox (
      event_key, event_type, school_id, actor_user_id,
      source_entity_type, source_entity_id, occurred_at, payload, status, available_at
    ) VALUES (
      v_event_key, v_event_type, NEW.school_id, COALESCE(NEW.cancelled_by, NEW.created_by),
      'course_schedule_replacement', NEW.id, NOW(), v_payload, 'pending', NOW()
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DO $c4_teacher_replacement_trigger$
BEGIN
  IF to_regclass('public.course_schedule_replacements') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_c4_teacher_replacement_event ON course_schedule_replacements';
    EXECUTE 'CREATE TRIGGER trg_c4_teacher_replacement_event
      AFTER INSERT OR UPDATE OF substitute_teacher_id, status
      ON course_schedule_replacements
      FOR EACH ROW EXECUTE FUNCTION somafrik_enqueue_teacher_replacement_event()';
  END IF;
END
$c4_teacher_replacement_trigger$;
