-- Code établissement public : {ISO}-{INITIALES}-{YY}-{SEQ3}
-- SEQ3 est un compteur GLOBAL par pays et par année civile.
-- Les initiales (somafrik_school_short_code) restent un segment lisible.
-- Elles NE participent PAS à la clé du compteur.
--
-- Clé cible : UNIQUE (country_id, creation_year)
-- Autorité : PostgreSQL only (trigger BEFORE INSERT).
--
-- IMMUTABILITÉ : aucun UPDATE de schools.login_code ici.
-- Les codes déjà émis (ex. CD-ISDC-26-001) restent tels quels.
-- last_value est relevé au MAX(seq) observé par pays/année pour les allocations futures.
--
-- Idempotent : ré-exécuté au boot via USER_ROLES_SCHEMA_SQL après 20260822.

DO $$
BEGIN
  IF to_regclass('public.school_login_code_counters_v2') IS NOT NULL
     AND to_regclass('public.school_login_code_counters') IS NULL THEN
    ALTER TABLE school_login_code_counters_v2 RENAME TO school_login_code_counters;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_login_code_counters'
      AND column_name = 'school_initials'
  ) THEN
    DROP TABLE IF EXISTS school_login_code_counters_v2;
    CREATE TABLE school_login_code_counters_v2 (
      country_id UUID NOT NULL REFERENCES countries(id),
      creation_year SMALLINT NOT NULL,
      last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (country_id, creation_year)
    );

    INSERT INTO school_login_code_counters_v2 (
      country_id, creation_year, last_value, created_at, updated_at
    )
    SELECT
      country_id,
      creation_year,
      max(last_value),
      min(created_at),
      NOW()
    FROM school_login_code_counters
    GROUP BY country_id, creation_year;

    DROP TABLE school_login_code_counters;
    ALTER TABLE school_login_code_counters_v2 RENAME TO school_login_code_counters;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS school_login_code_counters (
  country_id UUID NOT NULL REFERENCES countries(id),
  creation_year SMALLINT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (country_id, creation_year)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'school_login_code_counters_v2_pkey'
      AND conrelid = 'school_login_code_counters'::regclass
  ) THEN
    ALTER TABLE school_login_code_counters
      RENAME CONSTRAINT school_login_code_counters_v2_pkey
      TO school_login_code_counters_pkey;
  END IF;
END $$;

-- Relever le compteur sans réécrire les codes : MAX(SEQ3) par pays + année.
INSERT INTO school_login_code_counters (country_id, creation_year, last_value)
SELECT
  s.country_id,
  extract(year FROM coalesce(s.created_at, NOW()))::integer,
  max(split_part(s.login_code, '-', 4)::integer)
FROM schools s
WHERE s.login_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
GROUP BY
  s.country_id,
  extract(year FROM coalesce(s.created_at, NOW()))::integer
ON CONFLICT (country_id, creation_year)
DO UPDATE SET
  last_value = greatest(school_login_code_counters.last_value, EXCLUDED.last_value),
  updated_at = NOW();

CREATE OR REPLACE FUNCTION somafrik_prepare_school_login_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  iso TEXT;
  base_initials TEXT;
  school_creation_year INTEGER;
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
  school_creation_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;

  INSERT INTO school_login_code_counters (
    country_id,
    creation_year,
    last_value
  )
  VALUES (NEW.country_id, school_creation_year, 1)
  ON CONFLICT (country_id, creation_year)
  DO UPDATE SET
    last_value = school_login_code_counters.last_value + 1,
    updated_at = NOW()
  RETURNING last_value INTO sequence_value;

  IF sequence_value > 999 THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_SEQUENCE_EXHAUSTED: country %, year %',
      iso, school_creation_year;
  END IF;

  NEW.login_code :=
    iso || '-' || base_initials || '-' ||
    lpad((school_creation_year % 100)::text, 2, '0') || '-' ||
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

-- Garde INSERT : une SEQ3 ne peut plus être réémise pour le même pays + YY.
-- Les collisions déjà présentes (héritage per-initiales) ne sont pas réécrites
-- et ne sont pas revalidées ici.
CREATE OR REPLACE FUNCTION somafrik_guard_school_login_seq_unique()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.login_code IS NULL
     OR NEW.login_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schools other
    WHERE other.id IS DISTINCT FROM NEW.id
      AND other.login_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
      AND split_part(other.login_code, '-', 1) = split_part(NEW.login_code, '-', 1)
      AND split_part(other.login_code, '-', 3) = split_part(NEW.login_code, '-', 3)
      AND split_part(other.login_code, '-', 4) = split_part(NEW.login_code, '-', 4)
  ) THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_SEQ_COLLISION: % already used for country/year',
      NEW.login_code;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS zzz_schools_login_seq_guard ON schools;
CREATE TRIGGER zzz_schools_login_seq_guard
BEFORE INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION somafrik_guard_school_login_seq_unique();

CREATE UNIQUE INDEX IF NOT EXISTS schools_login_code_unique
  ON schools (upper(login_code));

DROP VIEW IF EXISTS school_login_code_seq_backfill_preview;
DROP VIEW IF EXISTS school_login_code_sequence_audit;

CREATE OR REPLACE VIEW school_login_code_sequence_audit AS
SELECT
  s.id,
  s.name,
  s.school_code,
  s.login_code,
  upper(btrim(c.iso_code)) AS country_iso,
  split_part(s.login_code, '-', 2) AS initials,
  extract(year FROM coalesce(s.created_at, NOW()))::integer AS created_year,
  split_part(s.login_code, '-', 3) AS year_yy,
  split_part(s.login_code, '-', 4)::integer AS seq,
  count(*) OVER (
    PARTITION BY
      s.country_id,
      split_part(s.login_code, '-', 3),
      split_part(s.login_code, '-', 4)
  ) > 1 AS sequence_collision
FROM schools s
JOIN countries c ON c.id = s.country_id
WHERE s.login_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$';

CREATE OR REPLACE VIEW school_login_code_seq_backfill_preview AS
SELECT
  ranked.*,
  ranked.current_login_code IS DISTINCT FROM ranked.proposed_login_code AS would_change
FROM (
  SELECT
    a.id,
    a.name,
    a.school_code,
    a.login_code AS current_login_code,
    a.country_iso,
    a.initials,
    a.created_year,
    a.seq AS current_seq,
    a.sequence_collision,
    row_number() OVER (
      PARTITION BY a.country_iso, a.created_year
      ORDER BY s.created_at NULLS LAST, a.school_code, a.id
    )::integer AS proposed_seq,
    a.country_iso || '-' || a.initials || '-' ||
      lpad((a.created_year % 100)::text, 2, '0') || '-' ||
      lpad(
        row_number() OVER (
          PARTITION BY a.country_iso, a.created_year
          ORDER BY s.created_at NULLS LAST, a.school_code, a.id
        )::text,
        3,
        '0'
      ) AS proposed_login_code
  FROM school_login_code_sequence_audit a
  JOIN schools s ON s.id = a.id
) ranked;
