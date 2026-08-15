-- Code établissement canonique de connexion.
-- Format : {ISO_PAYS}-{INITIALES_ETAB}-{YY_CREATION}-{SEQ3}, ex. CD-IK-26-001.
-- `school_code` et `short_code` restent des identifiants internes/aliases de compatibilité.
-- L'année est figée depuis created_at de la fiche établissement ; le code ne change jamais ensuite.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS login_code TEXT;

CREATE TABLE IF NOT EXISTS school_login_code_counters (
  country_id UUID NOT NULL REFERENCES countries(id),
  school_initials TEXT NOT NULL,
  creation_year SMALLINT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0 AND last_value <= 999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (country_id, school_initials, creation_year)
);

-- Backfill déterministe : plusieurs établissements peuvent partager les mêmes initiales.
WITH ranked AS (
  SELECT
    s.id,
    s.country_id,
    upper(btrim(c.iso_code)) AS country_code,
    somafrik_school_short_code(s.name) AS school_initials,
    extract(year FROM coalesce(s.created_at, NOW()))::integer AS creation_year,
    row_number() OVER (
      PARTITION BY
        s.country_id,
        somafrik_school_short_code(s.name),
        extract(year FROM coalesce(s.created_at, NOW()))::integer
      ORDER BY s.created_at NULLS LAST, s.school_code, s.id
    ) AS sequence_value
  FROM schools s
  JOIN countries c ON c.id = s.country_id
)
UPDATE schools s
SET login_code =
  r.country_code || '-' || r.school_initials || '-' ||
  lpad((r.creation_year % 100)::text, 2, '0') || '-' ||
  lpad(r.sequence_value::text, 3, '0')
FROM ranked r
WHERE s.id = r.id
  AND (
    nullif(btrim(s.login_code), '') IS NULL
    OR s.login_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM schools
    WHERE nullif(btrim(login_code), '') IS NULL
       OR login_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
  ) THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_CODE_BACKFILL_INCOMPLETE';
  END IF;
END $$;

-- Aligner les compteurs sur le backfill pour que la prochaine création continue à N+1.
INSERT INTO school_login_code_counters (country_id, school_initials, creation_year, last_value)
SELECT
  s.country_id,
  somafrik_school_short_code(s.name),
  extract(year FROM coalesce(s.created_at, NOW()))::integer,
  max(right(s.login_code, 3)::integer)
FROM schools s
GROUP BY
  s.country_id,
  somafrik_school_short_code(s.name),
  extract(year FROM coalesce(s.created_at, NOW()))::integer
ON CONFLICT (country_id, school_initials, creation_year)
DO UPDATE SET
  last_value = greatest(school_login_code_counters.last_value, EXCLUDED.last_value),
  updated_at = NOW();

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
      CHECK (login_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$') NOT VALID;
  ELSE
    ALTER TABLE schools DROP CONSTRAINT schools_login_code_format_check;
    ALTER TABLE schools ADD CONSTRAINT schools_login_code_format_check
      CHECK (login_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$') NOT VALID;
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
  base_initials TEXT;
  creation_year INTEGER;
  sequence_value INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.login_code IS NOT NULL THEN
    IF NEW.login_code IS DISTINCT FROM OLD.login_code
       OR NEW.country_id IS DISTINCT FROM OLD.country_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'SCHOOL_LOGIN_CODE_IMMUTABLE: %', OLD.login_code;
    END IF;
    RETURN NEW;
  END IF;

  SELECT upper(btrim(c.iso_code))
  INTO iso
  FROM countries c
  WHERE c.id = NEW.country_id;

  IF iso IS NULL OR iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_COUNTRY_REQUIRED';
  END IF;

  base_initials := somafrik_school_short_code(NEW.name);
  creation_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;

  INSERT INTO school_login_code_counters (
    country_id,
    school_initials,
    creation_year,
    last_value
  )
  VALUES (NEW.country_id, base_initials, creation_year, 1)
  ON CONFLICT (country_id, school_initials, creation_year)
  DO UPDATE SET
    last_value = school_login_code_counters.last_value + 1,
    updated_at = NOW()
  RETURNING last_value INTO sequence_value;

  IF sequence_value > 999 THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_SEQUENCE_EXHAUSTED: country %, initials %, year %',
      iso, base_initials, creation_year;
  END IF;

  -- Le client ne choisit jamais le code canonique : PostgreSQL le dérive.
  NEW.login_code :=
    iso || '-' || base_initials || '-' ||
    lpad((creation_year % 100)::text, 2, '0') || '-' ||
    lpad(sequence_value::text, 3, '0');
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS zz_schools_login_code_insert ON schools;
CREATE TRIGGER zz_schools_login_code_insert
BEFORE INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION somafrik_prepare_school_login_code();

DROP TRIGGER IF EXISTS zz_schools_login_code_update ON schools;
CREATE TRIGGER zz_schools_login_code_update
BEFORE UPDATE OF login_code, country_id, created_at ON schools
FOR EACH ROW EXECUTE FUNCTION somafrik_prepare_school_login_code();
