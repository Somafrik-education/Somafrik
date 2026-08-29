"use strict";

/**
 * ANN-PLATFORM-1 — Annonces Superadmin (administratives + système Somafrik).
 * Domaine distinct de C3 (announcements.school_id NOT NULL). Pas de school_id obligatoire.
 * all_active_users : users.status=active ET au moins un user_roles canonique actif.
 */

const PLATFORM_ANNOUNCEMENTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS platform_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_type TEXT NOT NULL,
  audience_key TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  published_by UUID NOT NULL REFERENCES users(id),
  sender_display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_announcements_type_check
    CHECK (announcement_type IN ('administrative', 'system')),
  CONSTRAINT platform_announcements_audience_check
    CHECK (audience_key IN ('country_admins', 'school_admins', 'all_admins', 'all_active_users')),
  CONSTRAINT platform_announcements_type_audience_check
    CHECK (
      (announcement_type = 'administrative' AND audience_key IN ('country_admins', 'school_admins', 'all_admins'))
      OR (announcement_type = 'system' AND audience_key = 'all_active_users')
    ),
  CONSTRAINT platform_announcements_status_check
    CHECK (status IN ('published', 'archived'))
);

CREATE TABLE IF NOT EXISTS platform_announcement_recipients (
  announcement_id UUID NOT NULL REFERENCES platform_announcements(id),
  user_id UUID NOT NULL REFERENCES users(id),
  recipient_kind TEXT NOT NULL,
  country_id UUID REFERENCES countries(id),
  school_id UUID REFERENCES schools(id),
  audience_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_announcement_reads (
  announcement_id UUID NOT NULL REFERENCES platform_announcements(id),
  user_id UUID NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_announcement_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES platform_announcements(id),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'uploaded'
);

CREATE INDEX IF NOT EXISTS idx_platform_announcement_recipients_user
  ON platform_announcement_recipients (user_id, announcement_id);
CREATE INDEX IF NOT EXISTS idx_platform_announcement_reads_user
  ON platform_announcement_reads (user_id, announcement_id);
CREATE INDEX IF NOT EXISTS idx_platform_announcements_published
  ON platform_announcements (published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_platform_announcement_attachments_announcement
  ON platform_announcement_attachments (announcement_id);
`;

module.exports = {
  PLATFORM_ANNOUNCEMENTS_SCHEMA_SQL,
};
