"use strict";

const STUDENT_GENERAL_IDENTITY_SQL = String.raw`
CREATE TABLE IF NOT EXISTS student_general_code_counters (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (last_value >= 0 AND last_value <= 99999)
);

CREATE OR REPLACE FUNCTION somafrik_student_person_initials(p_last_name TEXT, p_first_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  source TEXT;
  token TEXT;
  compact TEXT;
  result TEXT := '';
BEGIN
  -- Même translittération que somafrik_ascii_upper / studentIdentityInitials JS.
  -- last_name + first_name : Grâce Kabeya → KG, pas KGC.
  source := upper(translate(
    coalesce(p_last_name, '') || ' ' || coalesce(p_first_name, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝŸýÿŒœÆæ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYYyyOoAa'
  ));
  -- Après normalisation, les tokens sont séparés par des espaces simples.
  -- string_to_array(..., ' ') : POSIX \\s n'est PAS un blanc.
  source := trim(regexp_replace(source, '[^A-Z0-9]+', ' ', 'g'));
  FOR token IN SELECT unnest(string_to_array(source, ' ')) LOOP
    IF token <> '' THEN result := result || substr(token, 1, 1); END IF;
    EXIT WHEN length(result) >= 5;
  END LOOP;
  IF result = '' THEN RAISE EXCEPTION 'STUDENT_INITIALS_REQUIRED'; END IF;
  IF length(result) < 2 THEN
    compact := replace(source, ' ', '');
    result := substr(result || substr(compact, 2), 1, 5);
  END IF;
  RETURN substr(result, 1, 5);
END
$$;

CREATE OR REPLACE FUNCTION somafrik_assign_permanent_student_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  school_row RECORD;
  country_code TEXT;
  school_initials TEXT;
  person_initials TEXT;
  creation_year INTEGER;
  year_short TEXT;
  sequence_value INTEGER;
  canonical TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.student_code IS DISTINCT FROM NEW.student_code
       OR OLD.login_code IS DISTINCT FROM NEW.login_code
       OR OLD.identity_code IS DISTINCT FROM NEW.identity_code
       OR OLD.identity_initials IS DISTINCT FROM NEW.identity_initials
       OR OLD.identity_year IS DISTINCT FROM NEW.identity_year THEN
      RAISE EXCEPTION 'STUDENT_PERMANENT_IDENTIFIER_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;

  IF coalesce(NEW.student_code, '') <> '' AND NEW.student_code <> 'PENDING' THEN
    RAISE EXCEPTION 'STUDENT_CODE_SERVER_GENERATED';
  END IF;

  SELECT s.id, s.short_code, s.login_code, s.name, c.iso_code
  INTO school_row
  FROM schools s JOIN countries c ON c.id = s.country_id
  WHERE s.id = NEW.school_id;
  IF school_row.id IS NULL THEN RAISE EXCEPTION 'SCHOOL_NOT_FOUND'; END IF;

  country_code := upper(btrim(school_row.iso_code));
  school_initials := upper(nullif(btrim(school_row.short_code), ''));
  IF school_initials IS NULL AND coalesce(school_row.login_code, '') ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$' THEN
    school_initials := split_part(school_row.login_code, '-', 2);
  END IF;
  IF school_initials IS NULL THEN RAISE EXCEPTION 'SCHOOL_SHORT_CODE_REQUIRED'; END IF;

  person_initials := somafrik_student_person_initials(NEW.last_name, NEW.first_name);
  creation_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;
  year_short := lpad((creation_year % 100)::text, 2, '0');

  -- Séquence globale et continue PAR ÉTABLISSEMENT. Elle ne repart jamais à 1
  -- lors d'un changement d'année ni lorsque les initiales de l'élève changent.
  INSERT INTO student_general_code_counters (school_id, last_value)
  VALUES (NEW.school_id, 1)
  ON CONFLICT (school_id)
  DO UPDATE SET last_value = student_general_code_counters.last_value + 1, updated_at = NOW()
  RETURNING last_value INTO sequence_value;

  IF sequence_value > 99999 THEN RAISE EXCEPTION 'STUDENT_SEQUENCE_EXHAUSTED'; END IF;
  canonical := country_code || '-' || school_initials || '-' || person_initials || '-' || year_short || '-' || lpad(sequence_value::text, 5, '0');

  NEW.student_code := canonical;
  NEW.login_code := canonical;
  NEW.identity_code := canonical;
  NEW.identity_initials := person_initials;
  NEW.identity_year := creation_year;
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_canonical_identifier_format_check'
      AND conrelid = 'students'::regclass
  ) THEN
    ALTER TABLE students DROP CONSTRAINT students_canonical_identifier_format_check;
  END IF;
  ALTER TABLE students ADD CONSTRAINT students_canonical_identifier_format_check
    CHECK (
      (
        student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
        OR student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
      )
      AND login_code IS NOT DISTINCT FROM student_code
      AND identity_code IS NOT DISTINCT FROM student_code
    ) NOT VALID;
END $$;
`;

async function ensureStudentGeneralIdentityPg(repository) {
  if (!repository || repository.engine === "memory") return;
  await repository.query(STUDENT_GENERAL_IDENTITY_SQL);
}

module.exports = {
  STUDENT_GENERAL_IDENTITY_SQL,
  ensureStudentGeneralIdentityPg,
};
