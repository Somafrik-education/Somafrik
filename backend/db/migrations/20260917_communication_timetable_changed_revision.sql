-- Lot L4 P1 — change_revision monotone + snapshot payload immuable
-- Corrige clé OLD|NEW (cycle A→B→A→B) et drain historique hors état courant.

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

CREATE OR REPLACE FUNCTION somafrik_enqueue_communication_event()
RETURNS trigger AS $$
DECLARE
  v_event_type TEXT;
  v_source_type TEXT;
  v_source_id UUID;
  v_school_id UUID;
  v_actor UUID;
  v_event_key TEXT;
  v_payload JSONB := '{}'::jsonb;
  should_emit BOOLEAN := FALSE;
BEGIN
  IF TG_TABLE_NAME = 'school_messages' THEN
    v_event_type := 'communication.message.created';
    v_source_type := 'message';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NEW.sender_user_id;
    v_event_key := v_event_type || ':' || NEW.id::text;
    v_payload := jsonb_build_object('conversationId', NEW.conversation_id);
    should_emit := TRUE;

  ELSIF TG_TABLE_NAME = 'announcements' THEN
    v_event_type := 'communication.announcement.published';
    v_source_type := 'announcement';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := COALESCE(NEW.published_by, NEW.created_by);
    v_event_key := v_event_type || ':' || NEW.id::text;
    -- Publication uniquement. Un UPDATE d'une annonce déjà published
    -- (titre, audience, statut identique) ne réémet pas.
    should_emit := lower(trim(COALESCE(NEW.status, ''))) = 'published'
      AND (TG_OP = 'INSERT' OR lower(trim(COALESCE(OLD.status, ''))) <> 'published');

  ELSIF TG_TABLE_NAME = 'attendance' THEN
    v_source_type := 'attendance';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NEW.created_by;
    v_payload := jsonb_build_object('studentId', NEW.student_id, 'attendanceDate', NEW.attendance_date);
    IF lower(trim(COALESCE(NEW.status, ''))) IN ('absent', 'absence') THEN
      v_event_type := 'attendance.student.absent';
      v_event_key := v_event_type || ':' || NEW.id::text;
      should_emit := TG_OP = 'INSERT'
        OR lower(trim(COALESCE(OLD.status, ''))) NOT IN ('absent', 'absence');
    ELSIF lower(trim(COALESCE(NEW.status, ''))) IN ('late', 'retard') THEN
      v_event_type := 'attendance.student.late';
      v_event_key := v_event_type || ':' || NEW.id::text;
      should_emit := TG_OP = 'INSERT'
        OR lower(trim(COALESCE(OLD.status, ''))) NOT IN ('late', 'retard');
    END IF;

  ELSIF TG_TABLE_NAME = 'grades' THEN
    v_event_type := 'pedagogy.grade.published';
    v_source_type := 'grade';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := COALESCE(NEW.updated_by, NEW.created_by);
    v_event_key := v_event_type || ':' || NEW.id::text;
    v_payload := jsonb_build_object('studentId', NEW.student_id, 'subjectId', NEW.subject_id);
    -- Publication uniquement. NULL / draft / déjà published → pas de nouvel event.
    -- Un UPDATE de score d'une note déjà published ne réémet pas
    -- (trigger limité à publication_status + garde OLD <> published).
    should_emit := lower(trim(COALESCE(NEW.publication_status, ''))) = 'published'
      AND (TG_OP = 'INSERT' OR lower(trim(COALESCE(OLD.publication_status, ''))) <> 'published');

  ELSIF TG_TABLE_NAME = 'report_cards' THEN
    v_event_type := 'pedagogy.report_card.published';
    v_source_type := 'report_card';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NULL;
    v_event_key := v_event_type || ':' || NEW.id::text;
    v_payload := jsonb_build_object(
      'studentId', NEW.student_id,
      'academicYearId', NEW.academic_year_id,
      'termId', NEW.term_id
    );
    should_emit := lower(trim(COALESCE(NEW.status, ''))) = 'published'
      AND (TG_OP = 'INSERT' OR lower(trim(COALESCE(OLD.status, ''))) <> 'published');

  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_event_type := 'finance.payment.recorded';
    v_source_type := 'payment';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NEW.created_by;
    v_event_key := v_event_type || ':' || NEW.id::text;
    v_payload := jsonb_build_object('studentId', NEW.student_id, 'paymentCode', NEW.payment_code);
    -- cancelled_at n'existe que après le schéma finance. to_jsonb reste
    -- valide si la colonne est absente (bootstrap Clients sur schema.sql seul).
    should_emit := lower(trim(COALESCE(NEW.payment_status, ''))) = 'paid'
      AND (to_jsonb(NEW)->>'cancelled_at') IS NULL
      AND (
        TG_OP = 'INSERT'
        OR lower(trim(COALESCE(OLD.payment_status, ''))) <> 'paid'
        OR (to_jsonb(OLD)->>'cancelled_at') IS NOT NULL
      );

  ELSIF TG_TABLE_NAME = 'course_schedule_weekly_slots' THEN
    v_event_type := 'planning.timetable.changed';
    v_source_type := 'weekly_schedule_slot';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NULL;
    v_payload := jsonb_build_object(
      'weeklySlotId', NEW.id,
      'changeRevision', NEW.change_revision,
      'classId', NEW.class_id,
      'teacherId', NEW.teacher_id,
      'previousTeacherId', CASE
        WHEN OLD.teacher_id IS DISTINCT FROM NEW.teacher_id THEN OLD.teacher_id
        ELSE NULL
      END,
      'academicYearId', NEW.academic_year_id,
      'dayOfWeek', NEW.day_of_week,
      'startTime', NEW.start_time::text,
      'endTime', NEW.end_time::text,
      'status', NEW.status,
      'room', NEW.room,
      'roomId', NEW.room_id,
      'schoolCourseId', NEW.school_course_id
    );
    -- INSERT nouvelle séance → 0 event. Seules les modifications d'un créneau actif visible.
    IF TG_OP = 'UPDATE' AND lower(trim(COALESCE(OLD.status, ''))) = 'active' THEN
      should_emit := (
        OLD.day_of_week IS DISTINCT FROM NEW.day_of_week
        OR OLD.start_time IS DISTINCT FROM NEW.start_time
        OR OLD.end_time IS DISTINCT FROM NEW.end_time
        OR OLD.room IS DISTINCT FROM NEW.room
        OR OLD.room_id IS DISTINCT FROM NEW.room_id
        OR OLD.school_course_id IS DISTINCT FROM NEW.school_course_id
        OR OLD.teacher_id IS DISTINCT FROM NEW.teacher_id
        OR OLD.class_id IS DISTINCT FROM NEW.class_id
        OR NEW.status IS DISTINCT FROM OLD.status
      );
      IF should_emit THEN
        v_event_key := v_event_type || ':' || NEW.id::text || ':' || NEW.change_revision::text;
      END IF;
    END IF;
  END IF;

  IF should_emit THEN
    INSERT INTO communication_event_outbox (
      event_key, event_type, school_id, actor_user_id,
      source_entity_type, source_entity_id, occurred_at, payload, status, available_at
    ) VALUES (
      v_event_key, v_event_type, v_school_id, v_actor,
      v_source_type, v_source_id, NOW(), v_payload, 'pending', NOW()
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path TO pg_catalog, public, pg_temp;

