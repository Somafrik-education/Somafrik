"use strict";

const STUDENT_GENERAL_COUNTERS_MIGRATE_SQL = String.raw`
-- V1 historique : PRIMARY KEY (school_id, creation_year)
-- V2 canonique : PRIMARY KEY (school_id)
-- CREATE TABLE IF NOT EXISTS ne convertit pas une table existante.
-- Cette conversion DOIT précéder tout ON CONFLICT (school_id) (sinon 42P10).
CREATE TABLE IF NOT EXISTS student_general_code_counters (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (last_value >= 0 AND last_value <= 99999)
);

DO $migrate$
DECLARE
  has_creation_year BOOLEAN := FALSE;
  rec RECORD;
BEGIN
  IF to_regclass('public.student_general_code_counters') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.student_general_code_counters'::regclass
      AND attname = 'creation_year'
      AND attnum > 0
      AND NOT attisdropped
  ) INTO has_creation_year;

  IF has_creation_year THEN
    LOCK TABLE student_general_code_counters IN ACCESS EXCLUSIVE MODE;

    -- Une valeur par établissement : MAX(last_value) parmi toutes les années.
    -- Ex. school A / 2025 / 18 + 2026 / 27 → school A / 27 (jamais 0, 1 ou 45).
    DROP TABLE IF EXISTS student_general_code_counters_upgrade;
    CREATE TEMP TABLE student_general_code_counters_upgrade AS
    SELECT school_id, MAX(last_value)::integer AS last_value
    FROM student_general_code_counters
    GROUP BY school_id;

    DELETE FROM student_general_code_counters;

    FOR rec IN
      SELECT c.conname
      FROM pg_constraint c
      WHERE c.conrelid = 'public.student_general_code_counters'::regclass
        AND c.contype IN ('p', 'u', 'c')
        AND EXISTS (
          SELECT 1
          FROM pg_attribute a
          WHERE a.attrelid = c.conrelid
            AND a.attnum = ANY (c.conkey)
            AND a.attname = 'creation_year'
            AND NOT a.attisdropped
        )
    LOOP
      EXECUTE format('ALTER TABLE student_general_code_counters DROP CONSTRAINT %I', rec.conname);
    END LOOP;

    FOR rec IN
      SELECT DISTINCT idx.relname AS idxname
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN LATERAL unnest(i.indkey) AS k(attnum) ON TRUE
      JOIN pg_attribute a
        ON a.attrelid = i.indrelid
       AND a.attnum = k.attnum
      WHERE i.indrelid = 'public.student_general_code_counters'::regclass
        AND i.indisunique
        AND NOT i.indisprimary
        AND a.attname = 'creation_year'
        AND NOT a.attisdropped
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I', rec.idxname);
    END LOOP;

    ALTER TABLE student_general_code_counters DROP COLUMN creation_year;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.student_general_code_counters'::regclass
      AND c.contype IN ('p', 'u')
      AND array_length(c.conkey, 1) = 1
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attnum = c.conkey[1]
          AND a.attname = 'school_id'
          AND NOT a.attisdropped
      )
  ) THEN
    FOR rec IN
      SELECT c.conname
      FROM pg_constraint c
      WHERE c.conrelid = 'public.student_general_code_counters'::regclass
        AND c.contype = 'p'
    LOOP
      EXECUTE format('ALTER TABLE student_general_code_counters DROP CONSTRAINT %I', rec.conname);
    END LOOP;
    ALTER TABLE student_general_code_counters ADD PRIMARY KEY (school_id);
  END IF;

  IF has_creation_year THEN
    INSERT INTO student_general_code_counters (school_id, last_value)
    SELECT school_id, last_value
    FROM student_general_code_counters_upgrade;
    DROP TABLE IF EXISTS student_general_code_counters_upgrade;
  END IF;

  ALTER TABLE student_general_code_counters
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
END
$migrate$;
`;

const STUDENT_GENERAL_IDENTITY_SQL = String.raw`
${STUDENT_GENERAL_COUNTERS_MIGRATE_SQL}

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

CREATE OR REPLACE FUNCTION somafrik_student_identity_taken(p_canonical TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    coalesce(p_canonical, '') <> ''
    AND (
      EXISTS (
        SELECT 1 FROM students
        WHERE student_code = p_canonical
           OR login_code = p_canonical
           OR identity_code = p_canonical
      )
      OR EXISTS (
        SELECT 1 FROM users
        WHERE identity_code = p_canonical
           OR user_code = p_canonical
           OR login_code = p_canonical
      )
    );
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
  IF school_initials IS NULL OR school_initials !~ '^[A-Z0-9]{2,5}$' THEN
    school_initials := NULL;
    IF coalesce(school_row.login_code, '') ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$' THEN
      school_initials := split_part(school_row.login_code, '-', 2);
    END IF;
  END IF;
  IF school_initials IS NULL OR school_initials !~ '^[A-Z0-9]{2,5}$' THEN
    RAISE EXCEPTION 'SCHOOL_SHORT_CODE_REQUIRED';
  END IF;

  person_initials := somafrik_student_person_initials(NEW.last_name, NEW.first_name);
  creation_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;
  year_short := lpad((creation_year % 100)::text, 2, '0');

  -- Séquence globale et continue PAR ÉTABLISSEMENT. Elle ne repart jamais à 1
  -- lors d'un changement d'année ni lorsque les initiales de l'élève changent.
  -- #243 aligne le format élève sur l'identité staff ({ISO}-{ETAB}-{INITIALES}-{YY}-{SEQ5}).
  -- Sur une base préprod, users.identity_code staff (ex. CD-IN-OE-26-00001) peut déjà
  -- occuper la première SEQ5 : on saute les codes déjà pris (users/students), sans
  -- désactiver de contrainte ni revenir à SEQ3.
  LOOP
    INSERT INTO student_general_code_counters (school_id, last_value)
    VALUES (NEW.school_id, 1)
    ON CONFLICT (school_id)
    DO UPDATE SET last_value = student_general_code_counters.last_value + 1, updated_at = NOW()
    RETURNING last_value INTO sequence_value;

    IF sequence_value > 99999 THEN RAISE EXCEPTION 'STUDENT_SEQUENCE_EXHAUSTED'; END IF;
    canonical := country_code || '-' || school_initials || '-' || person_initials || '-' || year_short || '-' || lpad(sequence_value::text, 5, '0');
    EXIT WHEN NOT somafrik_student_identity_taken(canonical);
  END LOOP;

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

-- Remplace la branche élève de 20260823 (qui forçait identity_initials := 'EL').
-- Staff / non-élève : même allocation que 20260823 (somafrik_identity_initials + identity_counters).
CREATE OR REPLACE FUNCTION somafrik_assign_permanent_user_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  school_row RECORD;
  student_row RECORD;
  country_code TEXT;
  identity_creation_year INTEGER;
  year_short TEXT;
  initials TEXT;
  sequence_value INTEGER;
  short_login TEXT;
  full_identity TEXT;
  legacy_identifier TEXT;
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

  SELECT st.student_code, st.identity_initials, st.identity_year
  INTO student_row
  FROM students st
  WHERE st.school_id = NEW.school_id
    AND (
      st.student_code = NEW.user_code
      OR st.login_code = NEW.user_code
      OR st.identity_code = NEW.user_code
    )
  LIMIT 1;

  IF student_row.student_code IS NOT NULL OR student_role THEN
    IF student_row.student_code IS NULL THEN
      RAISE EXCEPTION 'STUDENT_CANONICAL_IDENTIFIER_REQUIRED';
    END IF;
    NEW.user_code := student_row.student_code;
    NEW.login_code := student_row.student_code;
    NEW.identity_code := student_row.student_code;
    NEW.identity_initials := coalesce(
      nullif(btrim(student_row.identity_initials), ''),
      split_part(student_row.student_code, '-', 3)
    );
    NEW.identity_year := coalesce(
      student_row.identity_year,
      (2000 + NULLIF(split_part(student_row.student_code, '-', 4), '')::integer)
    );
    IF NEW.identity_year IS NULL THEN
      NEW.identity_year := extract(year FROM coalesce(NEW.created_at, NOW()))::integer;
    END IF;
    legacy_identifier := nullif(btrim(coalesce(NEW.profile_payload->>'identifier', '')), '');
    NEW.profile_payload := coalesce(NEW.profile_payload, '{}'::jsonb)
      || jsonb_build_object(
        'identifier', student_row.student_code,
        'identityCode', student_row.student_code,
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

-- Compteur : reprendre au moins la SEQ5 déjà émise sur students (pas les EL-SEQ3).
-- Les collisions staff (users.identity_code) sont gérées par le saut dans le trigger.
INSERT INTO student_general_code_counters (school_id, last_value)
SELECT st.school_id, max(right(st.student_code, 5)::integer)
FROM students st
WHERE st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
GROUP BY st.school_id
ON CONFLICT (school_id)
DO UPDATE SET
  last_value = GREATEST(student_general_code_counters.last_value, EXCLUDED.last_value),
  updated_at = NOW();
`;

async function ensureStudentGeneralIdentityPg(repository) {
  if (!repository || repository.engine === "memory") return;
  await repository.query(STUDENT_GENERAL_IDENTITY_SQL);
}

module.exports = {
  STUDENT_GENERAL_COUNTERS_MIGRATE_SQL,
  STUDENT_GENERAL_IDENTITY_SQL,
  ensureStudentGeneralIdentityPg,
};
