"use strict";

const REPORT_CARD_PUBLICATION_SQL = `
CREATE TABLE IF NOT EXISTS report_card_published_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  report_card_id TEXT NOT NULL,
  published_snapshot_version INTEGER NOT NULL CHECK (published_snapshot_version >= 1),
  published_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status = 'PUBLISHED'),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
  public_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  wrapping_key_id TEXT NOT NULL,
  canonical_bytes BYTEA NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  snapshot_signature TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  engine_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_published_snapshots_version
    UNIQUE (school_id, report_card_id, published_snapshot_version),
  CONSTRAINT report_card_published_snapshots_public_id UNIQUE (public_id)
);

CREATE INDEX IF NOT EXISTS idx_report_card_published_snapshots_school
  ON report_card_published_snapshots (school_id, report_card_id);

CREATE UNIQUE INDEX IF NOT EXISTS report_card_published_snapshots_one_active
  ON report_card_published_snapshots (school_id, report_card_id)
  WHERE verification_status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS report_card_publish_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  report_card_id TEXT NOT NULL,
  published_snapshot_version INTEGER NOT NULL,
  public_id TEXT NOT NULL,
  event TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_publish_outbox_version
    UNIQUE (school_id, report_card_id, published_snapshot_version)
);

CREATE OR REPLACE FUNCTION report_card_published_snapshots_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLICATION_IMMUTABLE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.canonical_bytes IS DISTINCT FROM OLD.canonical_bytes
     OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256
     OR NEW.snapshot_signature IS DISTINCT FROM OLD.snapshot_signature
     OR NEW.signing_key_id IS DISTINCT FROM OLD.signing_key_id
     OR NEW.public_id IS DISTINCT FROM OLD.public_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.token_ciphertext IS DISTINCT FROM OLD.token_ciphertext
     OR NEW.wrapping_key_id IS DISTINCT FROM OLD.wrapping_key_id
     OR NEW.report_card_id IS DISTINCT FROM OLD.report_card_id
     OR NEW.published_snapshot_version IS DISTINCT FROM OLD.published_snapshot_version
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.engine_id IS DISTINCT FROM OLD.engine_id
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'PUBLICATION_IMMUTABLE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_published_snapshots_protect ON report_card_published_snapshots;
CREATE TRIGGER trg_report_card_published_snapshots_protect
BEFORE UPDATE OR DELETE ON report_card_published_snapshots
FOR EACH ROW
EXECUTE FUNCTION report_card_published_snapshots_protect();

CREATE OR REPLACE FUNCTION report_card_publish_outbox_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'PUBLICATION_IMMUTABLE'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_publish_outbox_protect ON report_card_publish_outbox;
CREATE TRIGGER trg_report_card_publish_outbox_protect
BEFORE UPDATE OR DELETE ON report_card_publish_outbox
FOR EACH ROW
EXECUTE FUNCTION report_card_publish_outbox_protect();

ALTER TABLE report_card_published_snapshots
  ADD COLUMN IF NOT EXISTS corrected_from_version INTEGER,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT,
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS command_id TEXT;

CREATE TABLE IF NOT EXISTS report_card_correction_commands (
  school_id UUID NOT NULL REFERENCES schools(id),
  report_card_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  result_version INTEGER NOT NULL,
  public_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, report_card_id, command_id)
);
`;

module.exports = { REPORT_CARD_PUBLICATION_SQL };
