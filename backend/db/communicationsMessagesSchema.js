"use strict";

/**
 * COM-C2 — schéma Messages (idempotent).
 * Appliqué après CLIENTS_SCHEMA_SQL. entity_type prépare C3/C4 sans leurs workflows.
 */

const COMMUNICATIONS_C2_SCHEMA_SQL = `
ALTER TABLE school_conversation_participants
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE school_conversation_participants
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS communication_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'uploaded'
);

CREATE INDEX IF NOT EXISTS idx_school_messages_conversation_sent_id
  ON school_messages (conversation_id, sent_at, id);
CREATE INDEX IF NOT EXISTS idx_school_messages_school_id
  ON school_messages (school_id);
CREATE INDEX IF NOT EXISTS idx_scp_user_school_active
  ON school_conversation_participants (user_id, school_id)
  WHERE COALESCE(status, 'active') = 'active';
CREATE INDEX IF NOT EXISTS idx_school_message_reads_user_message
  ON school_message_reads (user_id, message_id);
CREATE INDEX IF NOT EXISTS idx_communication_attachments_entity
  ON communication_attachments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_communication_attachments_school
  ON communication_attachments (school_id);
`;

module.exports = {
  COMMUNICATIONS_C2_SCHEMA_SQL,
};
