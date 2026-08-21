-- Source des initiales du login établissement : schools.short_code canonique.
--
-- Le trigger short_code (schools_short_code_insert) s'exécute avant
-- zz_schools_login_code_insert par ordre alphabétique des triggers PostgreSQL.
-- Ainsi :
-- - création normale : short_code est dérivé du nom puis utilisé pour login_code ;
-- - seed/import contrôlé : un short_code explicite et valide est respecté ;
-- - la séquence reste allouée exclusivement par PostgreSQL.
--
-- Aucun login_code fourni par le client n'est accepté comme autorité.

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

  base_initials := upper(btrim(coalesce(NEW.short_code, '')));
  IF base_initials = '' THEN
    base_initials := somafrik_school_short_code(NEW.name);
  END IF;
  IF base_initials !~ '^[A-Z0-9]{2,5}$' THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_INVALID: %', base_initials;
  END IF;

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
