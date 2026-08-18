"use strict";

/**
 * LOT 7 — Schéma canonique Clients / comptes (contacts, relations, messagerie).
 * Réutilise `users` et `announcements` existants ; pas de backfill JSON.
 */

const CLIENTS_SCHEMA_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  country_id UUID NOT NULL REFERENCES countries(id),
  contact_code VARCHAR(64),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  contact_type TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  gender TEXT,
  birth_date DATE,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  user_id UUID REFERENCES users(id),
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_json_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_school_phone
  ON contacts (school_id, lower(trim(phone)))
  WHERE phone IS NOT NULL AND trim(phone) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_school_email
  ON contacts (school_id, lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) <> '';

CREATE TABLE IF NOT EXISTS contact_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  country_id UUID NOT NULL REFERENCES countries(id),
  relation_type TEXT NOT NULL DEFAULT 'parent_student',
  contact_id UUID NOT NULL REFERENCES contacts(id),
  student_id UUID NOT NULL REFERENCES students(id),
  status TEXT NOT NULL DEFAULT 'active',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_json_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index uniques parent-linking : créés UNIQUEMENT par
-- ensureParentLinkingConstraints() APRÈS inventaire fail-safe.
-- Ne pas les recréer ici : un 23505 brut masquerait le diagnostic.

CREATE TABLE IF NOT EXISTS school_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  country_id UUID NOT NULL REFERENCES countries(id),
  subject TEXT,
  created_by_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES school_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  participant_role TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS school_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES school_conversations(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id),
  country_id UUID NOT NULL REFERENCES countries(id),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  direction TEXT,
  theme TEXT,
  priority TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  attachment_url TEXT,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_json_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_message_reads (
  message_id UUID NOT NULL REFERENCES school_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_school ON contacts (school_id);
CREATE INDEX IF NOT EXISTS idx_contact_relations_contact ON contact_relations (contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_relations_student ON contact_relations (student_id);
CREATE INDEX IF NOT EXISTS idx_school_messages_conversation ON school_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_school_messages_school ON school_messages (school_id);
`;

module.exports = {
  CLIENTS_SCHEMA_SQL,
};
