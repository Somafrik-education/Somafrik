-- Code établissement canonique de connexion.
-- Format : {ISO_PAYS}-{SHORT_CODE}, ex. CD-IK.
-- school_code historique reste un alias de compatibilité et n'est pas réécrit.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS login_code TEXT;

UPDATE schools s
SET login_code = upper(btrim(c.iso_code)) || '-' || upper(btrim(s.short_code))
FROM countries c
WHERE c.id = s.country_id
  AND nullif(btrim(s.login_code), '') IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM schools
    WHERE nullif(btrim(login_code), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_CODE_BACKFILL_INCOMPLETE';
  END IF;
END $$;

ALTER TABLE schools ALTER COLUMN login_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_login_code_format_check'
      AND conrelid = 'schools'::regclass
  ) THEN
    ALTER TABLE schools ADD CONSTRAINT schools_login_code_format_check
      CHECK (login_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}$') NOT VALID;
  END IF;
END $$;
ALTER TABLE schools VALIDATE CONSTRAINT schools_login_code_format_check;

CREATE UNIQUE INDEX IF NOT EXISTS schools_login_code_unique
  ON schools (upper(login_code));

CREATE OR REPLACE FUNCTION somafrik_prepare_school_login_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  iso TEXT;
  expected TEXT;
BEGIN
  SELECT upper(btrim(c.iso_code))
  INTO iso
  FROM countries c
  WHERE c.id = NEW.country_id;

  IF iso IS NULL OR iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_COUNTRY_REQUIRED';
  END IF;

  IF nullif(btrim(NEW.short_code), '') IS NULL THEN
    NEW.short_code := somafrik_school_short_code(NEW.name);
  END IF;

  expected := iso || '-' || upper(btrim(NEW.short_code));

  IF TG_OP = 'UPDATE'
     AND OLD.login_code IS NOT NULL
     AND expected IS DISTINCT FROM OLD.login_code THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_CODE_IMMUTABLE: %', OLD.login_code;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.login_code IS NOT NULL
     AND NEW.login_code IS DISTINCT FROM OLD.login_code THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_CODE_IMMUTABLE: %', OLD.login_code;
  END IF;

  -- Le client ne choisit jamais le code canonique : PostgreSQL le dérive.
  NEW.login_code := expected;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS zz_schools_login_code_insert ON schools;
CREATE TRIGGER zz_schools_login_code_insert
BEFORE INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION somafrik_prepare_school_login_code();

DROP TRIGGER IF EXISTS zz_schools_login_code_update ON schools;
CREATE TRIGGER zz_schools_login_code_update
BEFORE UPDATE OF login_code, country_id, short_code ON schools
FOR EACH ROW EXECUTE FUNCTION somafrik_prepare_school_login_code();
