"use strict";

const REPORT_CARD_SOURCE_ARTIFACT_SQL = `
CREATE TABLE IF NOT EXISTS report_card_source_artifacts (
  id UUID PRIMARY KEY,
  school_id UUID NOT NULL,
  request_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  current BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'ARCHIVED', 'PINNED')),
  media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  original_filename TEXT,
  storage_key TEXT NOT NULL,
  idempotency_key TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_source_artifacts_request_tenant
    FOREIGN KEY (request_id, school_id)
    REFERENCES report_card_configuration_requests (id, school_id),
  CONSTRAINT report_card_source_artifacts_request_version UNIQUE (request_id, version),
  CONSTRAINT report_card_source_artifacts_storage_key UNIQUE (storage_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_source_artifact_one_current
  ON report_card_source_artifacts (request_id)
  WHERE current;

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_source_artifact_idempotency
  ON report_card_source_artifacts (request_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_card_source_artifacts_school_request
  ON report_card_source_artifacts (school_id, request_id, version);

CREATE TABLE IF NOT EXISTS report_card_source_artifact_audit (
  id BIGSERIAL PRIMARY KEY,
  school_id UUID NOT NULL,
  request_id UUID NOT NULL,
  artifact_id UUID,
  artifact_sha256 TEXT,
  artifact_version INTEGER,
  action TEXT NOT NULL,
  to_state TEXT,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  profile_id UUID,
  profile_version INTEGER,
  profile_spec_sha256 TEXT,
  schema_id UUID,
  schema_version INTEGER,
  schema_spec_sha256 TEXT,
  template_id UUID,
  template_version INTEGER,
  template_spec_sha256 TEXT,
  configuration_audit_id BIGINT,
  CONSTRAINT report_card_source_artifact_audit_request_tenant
    FOREIGN KEY (request_id, school_id)
    REFERENCES report_card_configuration_requests (id, school_id)
);

ALTER TABLE report_card_source_artifact_audit
  ADD COLUMN IF NOT EXISTS artifact_version INTEGER,
  ADD COLUMN IF NOT EXISTS profile_id UUID,
  ADD COLUMN IF NOT EXISTS profile_version INTEGER,
  ADD COLUMN IF NOT EXISTS profile_spec_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS schema_id UUID,
  ADD COLUMN IF NOT EXISTS schema_version INTEGER,
  ADD COLUMN IF NOT EXISTS schema_spec_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS template_id UUID,
  ADD COLUMN IF NOT EXISTS template_version INTEGER,
  ADD COLUMN IF NOT EXISTS template_spec_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS configuration_audit_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_report_card_source_artifact_audit_request
  ON report_card_source_artifact_audit (school_id, request_id, id);

CREATE INDEX IF NOT EXISTS idx_report_card_source_artifact_audit_mapping
  ON report_card_source_artifact_audit (artifact_id, profile_id, schema_id, template_id);

CREATE OR REPLACE FUNCTION report_card_source_artifact_audit_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_source_artifact_audit_protect
  ON report_card_source_artifact_audit;
CREATE TRIGGER trg_report_card_source_artifact_audit_protect
BEFORE UPDATE OR DELETE ON report_card_source_artifact_audit
FOR EACH ROW
EXECUTE FUNCTION report_card_source_artifact_audit_protect();
`;

module.exports = { REPORT_CARD_SOURCE_ARTIFACT_SQL };
