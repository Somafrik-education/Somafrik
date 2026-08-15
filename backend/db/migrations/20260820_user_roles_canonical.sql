-- Comptes utilisateurs V2 — identité ≠ rôle ≠ profil métier
-- Idempotent. Inventaire fail-closed AVANT contrainte (voir userRolesSchema.js).

ALTER TABLE users ALTER COLUMN role DROP NOT NULL;

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  school_id UUID REFERENCES schools(id),
  role_key TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_roles_status_check CHECK (status IN ('active', 'revoked')),
  CONSTRAINT user_roles_revoked_consistency CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active_school_unique
  ON user_roles (user_id, school_id, role_key)
  WHERE status = 'active' AND revoked_at IS NULL AND school_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active_platform_unique
  ON user_roles (user_id, role_key)
  WHERE status = 'active' AND revoked_at IS NULL AND school_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_school ON user_roles (school_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_key ON user_roles (role_key);

CREATE TABLE IF NOT EXISTS user_code_counters (
  year INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Identifiants permanents V2
-- Format complet : CD-IK-GK-26-00001
-- Login établissement : GK-26-00001
-- L'année est l'année de création de l'identité, jamais l'année scolaire.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION somafrik_ascii_upper(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(
    translate(
      coalesce(value, ''),
      'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝŸýÿŒœÆæ',
      'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYYyyOoAa'
    )
  )
$$;

CREATE OR REPLACE FUNCTION somafrik_identity_initials(first_name TEXT, last_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  token TEXT;
  result TEXT := '';
BEGIN
  FOR token IN
    SELECT part
    FROM regexp_split_to_table(
      trim(regexp_replace(somafrik_ascii_upper(concat_ws(' ', first_name, last_name)), '[^A-Z0-9]+', ' ', 'g')),
      '\s+'
    ) AS part
    WHERE part <> ''
  LOOP
    result := result || left(token, 1);
    EXIT WHEN length(result) >= 5;
  END LOOP;

  IF result = '' THEN
    RAISE EXCEPTION 'IDENTITY_INITIALS_REQUIRED: prénom/nom insuffisants';
  END IF;

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION somafrik_school_short_code(name_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  token TEXT;
  result TEXT := '';
  normalized TEXT;
BEGIN
  normalized := trim(regexp_replace(somafrik_ascii_upper(name_value), '[^A-Z0-9]+', ' ', 'g'));
  FOR token IN SELECT part FROM regexp_split_to_table(normalized, '\s+') AS part WHERE part <> '' LOOP
    result := result || left(token, 1);
    EXIT WHEN length(result) >= 5;
  END LOOP;

  IF length(result) < 2 THEN
    result := left(regexp_replace(normalized, '\s+', '', 'g'), 5);
  END IF;
  IF result = '' THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_REQUIRED: nom établissement insuffisant';
  END IF;
  RETURN left(result, 5);
END
$$;

ALTER TABLE schools ADD COLUMN IF NOT EXISTS short_code TEXT;

DO $$
DECLARE
  row_record RECORD;
  candidate TEXT;
  suffix INTEGER;
BEGIN
  FOR row_record IN
    SELECT s.id, s.country_id, s.name, s.school_code
    FROM schools s
    WHERE nullif(btrim(s.short_code), '') IS NULL
    ORDER BY s.created_at NULLS LAST, s.school_code, s.id
  LOOP
    candidate := somafrik_school_short_code(row_record.name);
    suffix := 1;
    WHILE EXISTS (
      SELECT 1 FROM schools other
      WHERE other.country_id IS NOT DISTINCT FROM row_record.country_id
        AND other.id <> row_record.id
        AND upper(btrim(other.short_code)) = candidate
    ) LOOP
      suffix := suffix + 1;
      candidate := left(somafrik_school_short_code(row_record.name), greatest(1, 5 - length(suffix::text))) || suffix::text;
      IF suffix > 999 THEN
        RAISE EXCEPTION 'SCHOOL_SHORT_CODE_AMBIGUOUS: %', row_record.school_code;
      END IF;
    END LOOP;
    UPDATE schools SET short_code = candidate WHERE id = row_record.id;
  END LOOP;
END $$;

ALTER TABLE schools ALTER COLUMN short_code SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_short_code_format_check'
      AND conrelid = 'schools'::regclass
  ) THEN
    ALTER TABLE schools ADD CONSTRAINT schools_short_code_format_check
      CHECK (short_code ~ '^[A-Z0-9]{2,5}$') NOT VALID;
  END IF;
END $$;
ALTER TABLE schools VALIDATE CONSTRAINT schools_short_code_format_check;
CREATE UNIQUE INDEX IF NOT EXISTS schools_country_short_code_unique
  ON schools (country_id, upper(short_code));

CREATE OR REPLACE FUNCTION somafrik_prepare_school_short_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.short_code IS NOT NULL
     AND NEW.short_code IS DISTINCT FROM OLD.short_code THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_IMMUTABLE: %', OLD.short_code;
  END IF;

  IF nullif(btrim(NEW.short_code), '') IS NULL THEN
    NEW.short_code := somafrik_school_short_code(NEW.name);
  ELSE
    NEW.short_code := regexp_replace(somafrik_ascii_upper(NEW.short_code), '[^A-Z0-9]', '', 'g');
  END IF;

  IF length(NEW.short_code) < 2 OR length(NEW.short_code) > 5 THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_INVALID: %', NEW.short_code;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS schools_short_code_insert ON schools;
CREATE TRIGGER schools_short_code_insert
BEFORE INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION somafrik_prepare_school_short_code();

DROP TRIGGER IF EXISTS schools_short_code_update ON schools;
CREATE TRIGGER schools_short_code_update
BEFORE UPDATE OF short_code, name ON schools
FOR EACH ROW EXECUTE FUNCTION somafrik_prepare_school_short_code();

ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_initials TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_year SMALLINT;

CREATE TABLE IF NOT EXISTS identity_counters (
  school_id UUID NOT NULL REFERENCES schools(id),
  creation_year SMALLINT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, creation_year)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_identity_code_unique
  ON users (identity_code)
  WHERE identity_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_school_login_code_unique
  ON users (school_id, login_code)
  WHERE login_code IS NOT NULL;

CREATE OR REPLACE FUNCTION somafrik_assign_permanent_user_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  school_row RECORD;
  country_code TEXT;
  creation_year INTEGER;
  year_short TEXT;
  initials TEXT;
  sequence_value INTEGER;
  short_login TEXT;
  full_identity TEXT;
  legacy_identifier TEXT;
BEGIN
  -- Les comptes plateforme restent hors contrat établissement.
  IF NEW.school_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Une identité déjà attribuée est immuable.
  IF TG_OP = 'UPDATE' AND OLD.identity_code IS NOT NULL THEN
    IF NEW.identity_code IS DISTINCT FROM OLD.identity_code
       OR NEW.login_code IS DISTINCT FROM OLD.login_code
       OR NEW.identity_initials IS DISTINCT FROM OLD.identity_initials
       OR NEW.identity_year IS DISTINCT FROM OLD.identity_year THEN
      RAISE EXCEPTION 'PERMANENT_IDENTITY_IMMUTABLE: %', OLD.identity_code;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.identity_code IS NOT NULL OR NEW.login_code IS NOT NULL THEN
    RAISE EXCEPTION 'CLIENT_IDENTITY_CODE_FORBIDDEN';
  END IF;

  SELECT s.id, s.short_code, c.iso_code
  INTO school_row
  FROM schools s
  JOIN countries c ON c.id = s.country_id
  WHERE s.id = NEW.school_id;

  IF school_row.id IS NULL OR nullif(btrim(school_row.short_code), '') IS NULL THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_REQUIRED';
  END IF;

  country_code := upper(btrim(school_row.iso_code));
  creation_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;
  year_short := lpad((creation_year % 100)::text, 2, '0');
  initials := somafrik_identity_initials(NEW.first_name, NEW.last_name);

  INSERT INTO identity_counters (school_id, creation_year, last_value)
  VALUES (NEW.school_id, creation_year, 1)
  ON CONFLICT (school_id, creation_year)
  DO UPDATE SET last_value = identity_counters.last_value + 1, updated_at = NOW()
  RETURNING last_value INTO sequence_value;

  IF sequence_value > 99999 THEN
    RAISE EXCEPTION 'IDENTITY_SEQUENCE_EXHAUSTED: school %, year %', NEW.school_id, creation_year;
  END IF;

  short_login := initials || '-' || year_short || '-' || lpad(sequence_value::text, 5, '0');
  full_identity := country_code || '-' || upper(school_row.short_code) || '-' || short_login;

  NEW.identity_initials := initials;
  NEW.identity_year := creation_year;
  NEW.login_code := short_login;
  NEW.identity_code := full_identity;

  legacy_identifier := nullif(btrim(coalesce(NEW.profile_payload->>'identifier', '')), '');
  NEW.profile_payload := coalesce(NEW.profile_payload, '{}'::jsonb)
    || jsonb_build_object(
      'identifier', short_login,
      'identityCode', full_identity,
      'legacyIdentifier', legacy_identifier
    );

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS users_permanent_identity_insert ON users;
CREATE TRIGGER users_permanent_identity_insert
BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_user_identity();

DROP TRIGGER IF EXISTS users_permanent_identity_immutable ON users;
CREATE TRIGGER users_permanent_identity_immutable
BEFORE UPDATE OF identity_code, login_code, identity_initials, identity_year ON users
FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_user_identity();

DO $$
BEGIN
  IF to_regclass('public.establishment_roles') IS NOT NULL THEN
    UPDATE establishment_roles
    SET school_assignable = FALSE, updated_at = NOW()
    WHERE role_code IN ('PARENT', 'STUDENT')
       OR role_name IN ('Parent', 'Élève / Étudiant');
  END IF;
END $$;
