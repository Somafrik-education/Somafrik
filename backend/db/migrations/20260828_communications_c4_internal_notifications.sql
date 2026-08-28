-- COM-C4 — Notifications internes. Source de vérité distincte des notifications plateforme.
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

-- Les triggers sont installés par COMMUNICATIONS_C4_SCHEMA_SQL afin de rester
-- idempotents dans le bootstrap runtime et les bases de tests isolées.
