-- Lot I — règles notifications établissement (événement × destinataire × canal).
CREATE TABLE IF NOT EXISTS school_notification_settings (
  school_id UUID NOT NULL REFERENCES schools(id),
  event_key TEXT NOT NULL CHECK (event_key IN ('STUDENT_ABSENT', 'STUDENT_LATE', 'GRADE_PUBLISHED', 'REPORT_CARD_PUBLISHED', 'PAYMENT_RECEIVED', 'PAYMENT_DUE', 'ANNOUNCEMENT_PUBLISHED', 'TIMETABLE_CHANGED', 'TEACHER_REPLACEMENT')),
  recipient_category TEXT NOT NULL CHECK (recipient_category IN ('PARENT', 'STUDENT', 'TEACHER', 'SCHOOL_ADMIN')),
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL')),
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, event_key, recipient_category, channel),
  CONSTRAINT school_notification_settings_event_recipient_chk CHECK (
    (event_key = 'STUDENT_ABSENT' AND recipient_category = 'PARENT')
    OR (event_key = 'STUDENT_LATE' AND recipient_category = 'PARENT')
    OR (event_key = 'GRADE_PUBLISHED' AND recipient_category IN ('PARENT', 'STUDENT'))
    OR (event_key = 'REPORT_CARD_PUBLISHED' AND recipient_category IN ('PARENT', 'STUDENT'))
    OR (event_key = 'PAYMENT_RECEIVED' AND recipient_category = 'PARENT')
    OR (event_key = 'PAYMENT_DUE' AND recipient_category IN ('PARENT', 'SCHOOL_ADMIN'))
    OR (event_key = 'ANNOUNCEMENT_PUBLISHED' AND recipient_category IN ('PARENT', 'STUDENT', 'TEACHER', 'SCHOOL_ADMIN'))
    OR (event_key = 'TIMETABLE_CHANGED' AND recipient_category IN ('TEACHER', 'SCHOOL_ADMIN'))
    OR (event_key = 'TEACHER_REPLACEMENT' AND recipient_category IN ('PARENT', 'TEACHER', 'SCHOOL_ADMIN'))
  )
);

CREATE INDEX IF NOT EXISTS idx_school_notification_settings_school
  ON school_notification_settings (school_id);
