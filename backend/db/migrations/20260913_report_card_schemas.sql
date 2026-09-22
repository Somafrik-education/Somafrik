-- LOT 2 — ReportCardSchema versionné, isolé par school_id.
-- INSERT de versions ; spec immuable hors DRAFT ; pas de retour DRAFT ; seul DRAFT supprimable.

CREATE TABLE IF NOT EXISTS report_card_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  schema_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_schemas_school_key UNIQUE (school_id, schema_key),
  CONSTRAINT report_card_schemas_id_school UNIQUE (id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_report_card_schemas_school
  ON report_card_schemas (school_id);

CREATE TABLE IF NOT EXISTS report_card_schema_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  schema_id UUID NOT NULL REFERENCES report_card_schemas(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  spec JSONB NOT NULL,
  spec_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_schema_versions_unique UNIQUE (schema_id, version),
  CONSTRAINT report_card_schema_versions_schema_tenant
    FOREIGN KEY (schema_id, school_id)
    REFERENCES report_card_schemas (id, school_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_schema_one_active
  ON report_card_schema_versions (schema_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_report_card_schema_versions_school
  ON report_card_schema_versions (school_id, status);

CREATE OR REPLACE FUNCTION report_card_schema_versions_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'REPORT_CARD_SCHEMA_VERSION_IMMUTABLE'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IS DISTINCT FROM 'DRAFT' AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'REPORT_CARD_SCHEMA_VERSION_IMMUTABLE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status IS DISTINCT FROM 'DRAFT' THEN
    IF NEW.spec IS DISTINCT FROM OLD.spec
       OR NEW.spec_sha256 IS DISTINCT FROM OLD.spec_sha256
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.schema_id IS DISTINCT FROM OLD.schema_id
       OR NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'REPORT_CARD_SCHEMA_VERSION_IMMUTABLE'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_schema_versions_protect ON report_card_schema_versions;
CREATE TRIGGER trg_report_card_schema_versions_protect
BEFORE UPDATE OR DELETE ON report_card_schema_versions
FOR EACH ROW
EXECUTE FUNCTION report_card_schema_versions_protect();
