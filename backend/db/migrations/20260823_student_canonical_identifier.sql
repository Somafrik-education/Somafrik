-- Identifiant canonique élève = matricule = identifiant de connexion.
-- Format : {ISO_PAYS}-{INITIALES_ETAB}-EL-{YY}-{SEQ3}  ex. CD-IN-EL-26-001
-- student_code, login_code et identity_code portent la même valeur.
-- Compteur distinct de identity_counters (personnel / staff).
-- Schéma + triggers uniquement. Backfill legacy : 20260824 (opt-in, pas au boot).

CREATE TABLE IF NOT EXISTS student_login_code_counters (
  country_id UUID NOT NULL REFERENCES countries(id),
  school_initials TEXT NOT NULL,
  creation_year SMALLINT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0 AND last_value <= 999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (country_id, school_initials, creation_year)
);

CREATE OR REPLACE FUNCTION somafrik_student_canonical_code(
  country_iso TEXT,
  school_initials TEXT,
  creation_year INTEGER,
  sequence_value INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF country_iso IS NULL OR country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'COUNTRY_CODE_INVALID';
  END IF;
  IF school_initials IS NULL OR school_initials !~ '^[A-Z0-9]{2,5}$' THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_INVALID';
  END IF;
  IF sequence_value IS NULL OR sequence_value < 1 OR sequence_value > 999 THEN
    RAISE EXCEPTION 'STUDENT_SEQUENCE_EXHAUSTED';
  END IF;
  RETURN country_iso || '-' || school_initials || '-EL-' ||
    lpad((creation_year % 100)::text, 2, '0') || '-' ||
    lpad(sequence_value::text, 3, '0');
END
$$;

CREATE OR REPLACE FUNCTION somafrik_assign_permanent_student_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  school_row RECORD;
  identity_creation_year INTEGER;
  initials TEXT;
  sequence_value INTEGER;
  canonical TEXT;
  parsed_seq INTEGER;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$' THEN
    IF NEW.student_code IS DISTINCT FROM OLD.student_code
       OR NEW.login_code IS DISTINCT FROM OLD.login_code
       OR NEW.identity_code IS DISTINCT FROM OLD.identity_code THEN
      RAISE EXCEPTION 'STUDENT_CANONICAL_IDENTIFIER_IMMUTABLE: %', OLD.student_code;
    END IF;
    NEW.login_code := OLD.student_code;
    NEW.identity_code := OLD.student_code;
    RETURN NEW;
  END IF;

  SELECT
    s.id,
    s.login_code,
    s.short_code,
    s.name,
    s.country_id,
    upper(btrim(c.iso_code)) AS iso_code
  INTO school_row
  FROM schools s
  JOIN countries c ON c.id = s.country_id
  WHERE s.id = NEW.school_id;

  IF school_row.id IS NULL THEN
    RAISE EXCEPTION 'SCHOOL_REQUIRED_FOR_STUDENT_IDENTIFIER';
  END IF;

  IF coalesce(school_row.login_code, '') ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$' THEN
    initials := split_part(school_row.login_code, '-', 2);
  ELSIF nullif(btrim(school_row.short_code), '') IS NOT NULL THEN
    initials := upper(btrim(school_row.short_code));
  ELSE
    initials := somafrik_school_short_code(school_row.name);
  END IF;

  IF initials IS NULL OR initials !~ '^[A-Z0-9]{2,5}$' THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_REQUIRED';
  END IF;

  identity_creation_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;

  IF coalesce(NEW.student_code, '') ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$' THEN
    canonical := upper(btrim(NEW.student_code));
    parsed_seq := right(canonical, 3)::integer;
    INSERT INTO student_login_code_counters (
      country_id, school_initials, creation_year, last_value
    )
    VALUES (school_row.country_id, initials, identity_creation_year, parsed_seq)
    ON CONFLICT (country_id, school_initials, creation_year)
    DO UPDATE SET
      last_value = GREATEST(student_login_code_counters.last_value, EXCLUDED.last_value),
      updated_at = NOW();
  ELSE
    INSERT INTO student_login_code_counters (
      country_id, school_initials, creation_year, last_value
    )
    VALUES (school_row.country_id, initials, identity_creation_year, 1)
    ON CONFLICT (country_id, school_initials, creation_year)
    DO UPDATE SET
      last_value = student_login_code_counters.last_value + 1,
      updated_at = NOW()
    RETURNING last_value INTO sequence_value;

    IF sequence_value > 999 THEN
      RAISE EXCEPTION 'STUDENT_SEQUENCE_EXHAUSTED: country %, initials %, year %',
        school_row.iso_code, initials, identity_creation_year;
    END IF;

    canonical := somafrik_student_canonical_code(
      school_row.iso_code,
      initials,
      identity_creation_year,
      sequence_value
    );
  END IF;

  NEW.student_code := canonical;
  NEW.login_code := canonical;
  NEW.identity_code := canonical;
  NEW.identity_initials := 'EL';
  NEW.identity_year := identity_creation_year;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS students_permanent_identity_insert ON students;
CREATE TRIGGER students_permanent_identity_insert
BEFORE INSERT ON students
FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_student_identity();

DROP TRIGGER IF EXISTS students_permanent_identity_immutable ON students;
CREATE TRIGGER students_permanent_identity_immutable
BEFORE UPDATE OF student_code, identity_code, login_code, identity_initials, identity_year ON students
FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_student_identity();

CREATE OR REPLACE FUNCTION somafrik_assign_permanent_user_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  school_row RECORD;
  country_code TEXT;
  identity_creation_year INTEGER;
  year_short TEXT;
  initials TEXT;
  sequence_value INTEGER;
  short_login TEXT;
  full_identity TEXT;
  legacy_identifier TEXT;
  student_canonical TEXT;
  student_role BOOLEAN;
BEGIN
  IF NEW.school_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.identity_code IS NOT NULL THEN
    IF NEW.identity_code IS DISTINCT FROM OLD.identity_code
       OR NEW.login_code IS DISTINCT FROM OLD.login_code
       OR NEW.identity_initials IS DISTINCT FROM OLD.identity_initials
       OR NEW.identity_year IS DISTINCT FROM OLD.identity_year THEN
      RAISE EXCEPTION 'PERMANENT_IDENTITY_IMMUTABLE: %', OLD.identity_code;
    END IF;
    RETURN NEW;
  END IF;

  student_role := upper(btrim(coalesce(NEW.role, ''))) IN (
    'STUDENT', 'ÉLÈVE / ÉTUDIANT', 'ELEVE / ETUDIANT'
  );

  SELECT st.student_code
  INTO student_canonical
  FROM students st
  WHERE st.school_id = NEW.school_id
    AND (
      st.student_code = NEW.user_code
      OR st.login_code = NEW.user_code
      OR st.identity_code = NEW.user_code
    )
  LIMIT 1;

  IF student_canonical IS NOT NULL OR student_role THEN
    IF student_canonical IS NULL THEN
      RAISE EXCEPTION 'STUDENT_CANONICAL_IDENTIFIER_REQUIRED';
    END IF;
    NEW.user_code := student_canonical;
    NEW.login_code := student_canonical;
    NEW.identity_code := student_canonical;
    NEW.identity_initials := 'EL';
    NEW.identity_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;
    legacy_identifier := nullif(btrim(coalesce(NEW.profile_payload->>'identifier', '')), '');
    NEW.profile_payload := coalesce(NEW.profile_payload, '{}'::jsonb)
      || jsonb_build_object(
        'identifier', student_canonical,
        'identityCode', student_canonical,
        'legacyIdentifier', legacy_identifier
      );
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
  identity_creation_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;
  year_short := lpad((identity_creation_year % 100)::text, 2, '0');
  initials := somafrik_identity_initials(NEW.first_name, NEW.last_name);

  INSERT INTO identity_counters (school_id, creation_year, last_value)
  VALUES (NEW.school_id, identity_creation_year, 1)
  ON CONFLICT (school_id, creation_year)
  DO UPDATE SET last_value = identity_counters.last_value + 1, updated_at = NOW()
  RETURNING last_value INTO sequence_value;

  IF sequence_value > 99999 THEN
    RAISE EXCEPTION 'IDENTITY_SEQUENCE_EXHAUSTED: school %, year %', NEW.school_id, identity_creation_year;
  END IF;

  short_login := initials || '-' || year_short || '-' || lpad(sequence_value::text, 5, '0');
  full_identity := country_code || '-' || upper(school_row.short_code) || '-' || short_login;

  NEW.identity_initials := initials;
  NEW.identity_year := identity_creation_year;
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

-- CHECK NOT VALID : les lignes legacy restent lisibles jusqu'au backfill opt-in
-- (20260824 + script backfill-student-canonical-identifier.js).
-- Les INSERT/UPDATE futurs sont déjà contrôlés. Ne pas VALIDATE ici (boot).
-- Idempotence : ne PAS DROP/recréer si la contrainte existe déjà.
-- ensureStudentGeneralIdentityPg installe une CHECK plus large (SEQ5 | EL) ;
-- la recréer en EL-only à chaque boot fait échouer tout UPDATE students SEQ5 (23514).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_canonical_identifier_format_check'
      AND conrelid = 'students'::regclass
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_canonical_identifier_format_check
      CHECK (
        student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
        AND login_code IS NOT DISTINCT FROM student_code
        AND identity_code IS NOT DISTINCT FROM student_code
      ) NOT VALID;
  END IF;
END $$;
