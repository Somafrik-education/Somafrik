-- Lot L1 — STUDENT_LATE : producteur outbox attendance.student.late
-- Idempotent : remplace la fonction enqueue sans dupliquer les triggers.

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
    should_emit := lower(trim(COALESCE(NEW.publication_status, ''))) = 'published'
      AND (TG_OP = 'INSERT' OR lower(trim(COALESCE(OLD.publication_status, ''))) <> 'published');

  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_event_type := 'finance.payment.recorded';
    v_source_type := 'payment';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NEW.created_by;
    v_event_key := v_event_type || ':' || NEW.id::text;
    v_payload := jsonb_build_object('studentId', NEW.student_id, 'paymentCode', NEW.payment_code);
    should_emit := lower(trim(COALESCE(NEW.payment_status, ''))) = 'paid'
      AND (to_jsonb(NEW)->>'cancelled_at') IS NULL
      AND (
        TG_OP = 'INSERT'
        OR lower(trim(COALESCE(OLD.payment_status, ''))) <> 'paid'
        OR (to_jsonb(OLD)->>'cancelled_at') IS NOT NULL
      );
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
