"use strict";

const ACADEMIC_RULE_PROFILE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS academic_rule_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  profile_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_rule_profiles_school_key UNIQUE (school_id, profile_key),
  CONSTRAINT academic_rule_profiles_id_school UNIQUE (id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_academic_rule_profiles_school
  ON academic_rule_profiles (school_id);

CREATE TABLE IF NOT EXISTS academic_rule_profile_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  profile_id UUID NOT NULL REFERENCES academic_rule_profiles(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  spec JSONB NOT NULL,
  spec_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_rule_profile_versions_unique UNIQUE (profile_id, version),
  CONSTRAINT academic_rule_profile_versions_profile_tenant
    FOREIGN KEY (profile_id, school_id)
    REFERENCES academic_rule_profiles (id, school_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_rule_profile_one_active
  ON academic_rule_profile_versions (profile_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_academic_rule_profile_versions_school
  ON academic_rule_profile_versions (school_id, status);

CREATE OR REPLACE FUNCTION academic_rule_profile_versions_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ACTIVE', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'ACADEMIC_RULE_PROFILE_VERSION_IMMUTABLE'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IS DISTINCT FROM 'DRAFT' THEN
    IF NEW.spec IS DISTINCT FROM OLD.spec
       OR NEW.spec_sha256 IS DISTINCT FROM OLD.spec_sha256
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
       OR NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'ACADEMIC_RULE_PROFILE_VERSION_IMMUTABLE'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_academic_rule_profile_versions_protect ON academic_rule_profile_versions;
CREATE TRIGGER trg_academic_rule_profile_versions_protect
BEFORE UPDATE OR DELETE ON academic_rule_profile_versions
FOR EACH ROW
EXECUTE FUNCTION academic_rule_profile_versions_protect();
`;

module.exports = { ACADEMIC_RULE_PROFILE_SCHEMA_SQL };
