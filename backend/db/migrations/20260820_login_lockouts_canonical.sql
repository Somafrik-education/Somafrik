-- LOT 6 — Lockout de connexion canonique (idempotent).
-- SoT PostgreSQL : plus de Map processus.
CREATE TABLE IF NOT EXISTS login_lockouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  school_scope TEXT NOT NULL,
  identifier_normalized TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT login_lockouts_scope_identifier_unique UNIQUE (school_scope, identifier_normalized),
  CONSTRAINT login_lockouts_failed_attempts_nonneg CHECK (failed_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_login_lockouts_locked_until
  ON login_lockouts (locked_until)
  WHERE locked_until IS NOT NULL;
