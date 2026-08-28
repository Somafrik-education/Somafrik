"use strict";

/**
 * COM-C4 — Notifications internes + outbox PostgreSQL idempotente.
 * Domaine volontairement distinct de la table plateforme `notifications`.
 */

const COMMUNICATIONS_C4_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS communication_event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  school_id UUID NOT NULL REFERENCES schools(id),
  actor_user_id UUID REFERENCES users(id),
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS communication_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  event_id UUID REFERENCES communication_event_outbox(id),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('system', 'user')),
  sender_user_id UUID REFERENCES users(id),
  sender_name TEXT NOT NULL,
  navigation_target JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id UUID NOT NULL REFERENCES communication_notifications(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  user_id UUID NOT NULL REFERENCES users(id),
  recipient_kind TEXT NOT NULL DEFAULT 'user',
  recipient_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_communication_event_outbox_pending
  ON communication_event_outbox (status, available_at, occurred_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_communication_notifications_school_created
  ON communication_notifications (school_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_communication_notifications_source
  ON communication_notifications (event_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_notification_recipients_user_unread
  ON notification_recipients (user_id, school_id, read_at, notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_recipients_school_user
  ON notification_recipients (school_id, user_id, notification_id);

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
    v_event_type := 'attendance.student.absent';
    v_source_type := 'attendance';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NEW.created_by;
    v_event_key := v_event_type || ':' || NEW.id::text;
    v_payload := jsonb_build_object('studentId', NEW.student_id, 'attendanceDate', NEW.attendance_date);
    should_emit := lower(trim(COALESCE(NEW.status, ''))) IN ('absent', 'absence')
      AND (TG_OP = 'INSERT' OR lower(trim(COALESCE(OLD.status, ''))) NOT IN ('absent', 'absence'));

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

  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_event_type := 'finance.payment.recorded';
    v_source_type := 'payment';
    v_source_id := NEW.id;
    v_school_id := NEW.school_id;
    v_actor := NEW.created_by;
    v_event_key := v_event_type || ':' || NEW.id::text;
    v_payload := jsonb_build_object('studentId', NEW.student_id, 'paymentCode', NEW.payment_code);
    should_emit := lower(trim(COALESCE(NEW.payment_status, ''))) = 'paid'
      AND NEW.cancelled_at IS NULL
      AND (TG_OP = 'INSERT' OR lower(trim(COALESCE(OLD.payment_status, ''))) <> 'paid' OR OLD.cancelled_at IS NOT NULL);
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_c4_message_event ON school_messages;
CREATE TRIGGER trg_c4_message_event
AFTER INSERT ON school_messages
FOR EACH ROW EXECUTE FUNCTION somafrik_enqueue_communication_event();

DROP TRIGGER IF EXISTS trg_c4_announcement_event ON announcements;
CREATE TRIGGER trg_c4_announcement_event
AFTER INSERT OR UPDATE OF status ON announcements
FOR EACH ROW EXECUTE FUNCTION somafrik_enqueue_communication_event();

DROP TRIGGER IF EXISTS trg_c4_attendance_event ON attendance;
CREATE TRIGGER trg_c4_attendance_event
AFTER INSERT OR UPDATE OF status ON attendance
FOR EACH ROW EXECUTE FUNCTION somafrik_enqueue_communication_event();

DROP TRIGGER IF EXISTS trg_c4_grade_event ON grades;
CREATE TRIGGER trg_c4_grade_event
AFTER INSERT OR UPDATE OF publication_status ON grades
FOR EACH ROW EXECUTE FUNCTION somafrik_enqueue_communication_event();

DROP TRIGGER IF EXISTS trg_c4_payment_event ON payments;
CREATE TRIGGER trg_c4_payment_event
AFTER INSERT OR UPDATE OF payment_status, cancelled_at ON payments
FOR EACH ROW EXECUTE FUNCTION somafrik_enqueue_communication_event();
`;

module.exports = {
  COMMUNICATIONS_C4_SCHEMA_SQL,
};
