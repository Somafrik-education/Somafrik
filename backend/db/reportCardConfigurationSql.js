"use strict";

const REPORT_CARD_CONFIGURATION_SQL = `
CREATE TABLE IF NOT EXISTS report_card_rendering_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  template_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_rendering_templates_school_key UNIQUE (school_id, template_key),
  CONSTRAINT report_card_rendering_templates_id_school UNIQUE (id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_report_card_rendering_templates_school
  ON report_card_rendering_templates (school_id);

CREATE TABLE IF NOT EXISTS report_card_rendering_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  template_id UUID NOT NULL REFERENCES report_card_rendering_templates(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  spec JSONB NOT NULL,
  spec_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_rendering_template_versions_unique UNIQUE (template_id, version),
  CONSTRAINT report_card_rendering_template_versions_tenant
    FOREIGN KEY (template_id, school_id)
    REFERENCES report_card_rendering_templates (id, school_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_rendering_template_one_active
  ON report_card_rendering_template_versions (template_id)
  WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION report_card_rendering_template_versions_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'RENDERING_TEMPLATE_VERSION_IMMUTABLE'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IS DISTINCT FROM 'DRAFT' AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'RENDERING_TEMPLATE_VERSION_IMMUTABLE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status IS DISTINCT FROM 'DRAFT' THEN
    IF NEW.spec IS DISTINCT FROM OLD.spec
       OR NEW.spec_sha256 IS DISTINCT FROM OLD.spec_sha256
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'RENDERING_TEMPLATE_VERSION_IMMUTABLE'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_rendering_template_versions_protect
  ON report_card_rendering_template_versions;
CREATE TRIGGER trg_report_card_rendering_template_versions_protect
BEFORE UPDATE OR DELETE ON report_card_rendering_template_versions
FOR EACH ROW
EXECUTE FUNCTION report_card_rendering_template_versions_protect();

CREATE TABLE IF NOT EXISTS report_card_configuration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  model_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'SUBMITTED',
    'UNDER_REVIEW',
    'CONFIGURING',
    'READY_FOR_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED',
    'ACTIVE',
    'REJECTED',
    'ARCHIVED'
  )),
  concurrency_version INTEGER NOT NULL DEFAULT 1 CHECK (concurrency_version >= 1),
  description TEXT,
  profile_id UUID,
  profile_version INTEGER,
  profile_spec_sha256 TEXT,
  schema_id UUID,
  schema_version INTEGER,
  schema_spec_sha256 TEXT,
  rendering_template_id UUID,
  rendering_template_version INTEGER,
  rendering_template_spec_sha256 TEXT,
  engine_id TEXT,
  last_actor_id TEXT,
  last_permission TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_configuration_requests_id_school UNIQUE (id, school_id),
  CONSTRAINT report_card_configuration_requests_template_tenant
    FOREIGN KEY (rendering_template_id, school_id)
    REFERENCES report_card_rendering_templates (id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_report_card_configuration_requests_school
  ON report_card_configuration_requests (school_id, model_key, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active
  ON report_card_configuration_requests (school_id, model_key)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS report_card_active_bindings (
  school_id UUID NOT NULL REFERENCES schools(id),
  model_key TEXT NOT NULL,
  request_id UUID NOT NULL,
  engine_id TEXT NOT NULL,
  profile_id UUID NOT NULL,
  profile_version INTEGER NOT NULL,
  profile_spec_sha256 TEXT NOT NULL,
  schema_id UUID NOT NULL,
  schema_version INTEGER NOT NULL,
  schema_spec_sha256 TEXT NOT NULL,
  rendering_template_id UUID NOT NULL,
  rendering_template_version INTEGER NOT NULL,
  rendering_template_spec_sha256 TEXT NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, model_key),
  CONSTRAINT report_card_active_bindings_request_tenant
    FOREIGN KEY (request_id, school_id)
    REFERENCES report_card_configuration_requests (id, school_id)
);

CREATE TABLE IF NOT EXISTS report_card_configuration_audit (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL,
  school_id UUID NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  reason TEXT,
  command_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_configuration_audit_request_tenant
    FOREIGN KEY (request_id, school_id)
    REFERENCES report_card_configuration_requests (id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_report_card_configuration_audit_request
  ON report_card_configuration_audit (school_id, request_id, id);

CREATE OR REPLACE FUNCTION report_card_configuration_audit_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_configuration_audit_protect
  ON report_card_configuration_audit;
CREATE TRIGGER trg_report_card_configuration_audit_protect
BEFORE UPDATE OR DELETE ON report_card_configuration_audit
FOR EACH ROW
EXECUTE FUNCTION report_card_configuration_audit_protect();

CREATE TABLE IF NOT EXISTS report_card_configuration_commands (
  command_id TEXT PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id),
  request_id UUID NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_configuration_commands_request_tenant
    FOREIGN KEY (request_id, school_id)
    REFERENCES report_card_configuration_requests (id, school_id)
);
`;

module.exports = { REPORT_CARD_CONFIGURATION_SQL };
