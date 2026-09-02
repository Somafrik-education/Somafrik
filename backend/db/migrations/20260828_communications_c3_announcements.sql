-- COM-C3 — Annonces production-ready
-- Snapshot destinataires, read/unread PostgreSQL, audience immutable.
-- Idempotent. Boot via ensureClientsCanonicalBootstrap → applyCommunicationsC3Schema.

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id);
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS audience_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS announcement_recipients (
  announcement_id UUID NOT NULL REFERENCES announcements(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  user_id UUID NOT NULL REFERENCES users(id),
  recipient_kind TEXT NOT NULL,
  audience_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id UUID NOT NULL REFERENCES announcements(id),
  user_id UUID NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_recipients_user_announcement
  ON announcement_recipients (user_id, announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients_school_announcement
  ON announcement_recipients (school_id, announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user_announcement
  ON announcement_reads (user_id, announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcements_school_published
  ON announcements (school_id, published_at DESC, id DESC);

-- Backfill RBAC Announcements : voir reconcileCanonicalAnnouncementsGrants
-- (après seed functional_modules). Ne pas INSERT ici : FK module_key.
