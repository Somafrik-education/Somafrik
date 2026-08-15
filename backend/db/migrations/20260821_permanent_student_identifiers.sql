-- Identifiants permanents élèves — extension non destructive.
-- student_code reste un alias métier legacy ; identity_code devient l'identité humaine permanente.

-- Le runtime Clients ajoute déjà cette colonne avant ensureUserRolesCanonicalSchema.
-- Ce garde rend néanmoins la migration autonome sur un schéma legacy/frais.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE students ADD COLUMN IF NOT EXISTS identity_code TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS login_code TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS identity_initials TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS identity_year SMALLINT;

CREATE UNIQUE INDEX IF NOT EXISTS students_identity_code_unique
  ON students (identity_code)
  WHERE identity_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS students_school_login_code_unique
  ON students (school_id, login_code)
  WHERE login_code IS NOT NULL;

CREATE OR REPLACE FUNCTION somafrik_assign_permanent_student_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  school_row RECORD;
  creation_year INTEGER;
  year_short TEXT;
  initials TEXT;
  sequence_value INTEGER;
  short_login TEXT;
  full_identity TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.identity_code IS NOT NULL THEN
    IF NEW.identity_code IS DISTINCT FROM OLD.identity_code
       OR NEW.login_code IS DISTINCT FROM OLD.login_code
       OR NEW.identity_initials IS DISTINCT FROM OLD.identity_initials
       OR NEW.identity_year IS DISTINCT FROM OLD.identity_year THEN
      RAISE EXCEPTION 'PERMANENT_STUDENT_IDENTITY_IMMUTABLE: %', OLD.identity_code;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.identity_code IS NOT NULL OR NEW.login_code IS NOT NULL THEN
    RAISE EXCEPTION 'CLIENT_STUDENT_IDENTITY_CODE_FORBIDDEN';
  END IF;

  SELECT s.id, s.short_code, c.iso_code
  INTO school_row
  FROM schools s
  JOIN countries c ON c.id = s.country_id
  WHERE s.id = NEW.school_id;

  IF school_row.id IS NULL OR nullif(btrim(school_row.short_code), '') IS NULL THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_REQUIRED';
  END IF;

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
  full_identity := upper(btrim(school_row.iso_code)) || '-' || upper(btrim(school_row.short_code)) || '-' || short_login;

  NEW.identity_initials := initials;
  NEW.identity_year := creation_year;
  NEW.login_code := short_login;
  NEW.identity_code := full_identity;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS students_permanent_identity_insert ON students;
CREATE TRIGGER students_permanent_identity_insert
BEFORE INSERT ON students
FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_student_identity();

DROP TRIGGER IF EXISTS students_permanent_identity_immutable ON students;
CREATE TRIGGER students_permanent_identity_immutable
BEFORE UPDATE OF identity_code, login_code, identity_initials, identity_year ON students
FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_student_identity();
