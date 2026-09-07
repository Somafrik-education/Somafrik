-- Demandes d'essai public (V1 sans SMTP, sans auto-provision).
-- Idempotent : aussi appliqué via backend/db/schema.sql au boot.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS trial_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref TEXT NOT NULL UNIQUE,
  requester_name TEXT NOT NULL,
  role TEXT NOT NULL,
  school_name TEXT NOT NULL,
  country_iso VARCHAR(8) NOT NULL,
  city TEXT,
  phone TEXT,
  email TEXT NOT NULL,
  student_band TEXT,
  school_id UUID REFERENCES schools(id),
  status TEXT NOT NULL DEFAULT 'nouvelle',
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trial_access_requests_status_check CHECK (
    status IN ('nouvelle', 'contactee', 'qualifiee', 'essai_active', 'convertie', 'refusee', 'abandonnee')
  )
);

CREATE INDEX IF NOT EXISTS idx_trial_access_requests_status_created
  ON trial_access_requests (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_access_requests_open_email_school
  ON trial_access_requests (lower(email), lower(school_name))
  WHERE status IN ('nouvelle', 'contactee', 'qualifiee', 'essai_active');
