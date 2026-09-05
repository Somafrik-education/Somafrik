-- P1 #503 — rotation refresh, demandes d'effacement, colonnes de rétention.
-- Idempotente. INTERDIT : exécuter sur Somafrik-prod depuis Cursor.

ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS previous_refresh_token_hash TEXT;
ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS refresh_rotated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS refresh_token_grace TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code TEXT NOT NULL UNIQUE,
  school_id UUID REFERENCES schools(id),
  user_id UUID REFERENCES users(id),
  school_code TEXT,
  identifier TEXT,
  contact_email TEXT,
  role_label TEXT,
  request_type TEXT NOT NULL DEFAULT 'erasure',
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  actor_user_id UUID REFERENCES users(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privacy_requests_type_check CHECK (request_type IN ('erasure', 'access', 'rectification')),
  CONSTRAINT privacy_requests_status_check CHECK (status IN ('pending', 'processed', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_school_status
  ON privacy_requests (school_id, status, created_at DESC);
