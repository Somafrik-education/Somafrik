-- Code établissement public : les initiales lisibles ne doivent jamais hériter
-- du suffixe d'unicité du short_code interne (IK, IK2, IK3...).
--
-- Contrat :
-- - création normale : initiales publiques dérivées du nom ;
-- - collision short_code : IK2 reste interne, le login public conserve IK ;
-- - override contrôlé explicite : un short_code sémantique distinct du nom
--   (ex. IN pour le fixture CD-IN-26-001) peut servir d'initiales publiques ;
-- - séquence globale (country_id, creation_year) et immutabilité inchangées ;
-- - aucun login_code existant n'est réécrit.

CREATE OR REPLACE FUNCTION somafrik_school_public_login_initials(
  name_value TEXT,
  short_code_value TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  name_initials TEXT;
  normalized_short TEXT;
  suffix_text TEXT;
  generated_prefix TEXT;
BEGIN
  name_initials := somafrik_school_short_code(name_value);
  normalized_short := regexp_replace(
    somafrik_ascii_upper(coalesce(short_code_value, '')),
    '[^A-Z0-9]',
    '',
    'g'
  );

  IF normalized_short = '' OR normalized_short = name_initials THEN
    RETURN name_initials;
  END IF;

  -- Le trigger short_code ajoute un suffixe numérique en tronquant au besoin
  -- pour rester à 5 caractères (ABCDE -> ABCD2). Ce suffixe est strictement
  -- interne et ne doit pas modifier les initiales du login_code public.
  suffix_text := substring(normalized_short FROM '([0-9]+)$');
  IF suffix_text IS NOT NULL THEN
    generated_prefix := left(name_initials, greatest(1, 5 - length(suffix_text)));
    IF normalized_short = generated_prefix || suffix_text THEN
      RETURN name_initials;
    END IF;
  END IF;

  IF length(normalized_short) < 2 OR length(normalized_short) > 5 THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_INITIALS_INVALID: %', normalized_short;
  END IF;

  RETURN normalized_short;
END
$$;

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

  base_initials := somafrik_school_public_login_initials(NEW.name, NEW.short_code);
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