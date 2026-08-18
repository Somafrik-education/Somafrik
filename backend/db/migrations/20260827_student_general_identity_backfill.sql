-- Backfill opt-in : anciens matricules élèves -> {ISO}-{ETAB}-{INITIALES_ELEVE}-{YY}-{SEQ5}
-- Exemple : CD-IN-EL-26-001 -> CD-IN-OHS-26-00001 pour OKITO Hope Sabrina.
-- La séquence SEQ5 est globale et continue par établissement, toutes années et initiales confondues.
-- Précondition : studentGeneralIdentityPg a installé les fonctions/counters canoniques.
-- Une seule transaction ; aucun DELETE.

BEGIN;

ALTER TABLE students DISABLE TRIGGER USER;
ALTER TABLE users DISABLE TRIGGER USER;

CREATE TEMP TABLE student_general_identity_remap (
  id UUID PRIMARY KEY,
  old_code TEXT NOT NULL,
  new_code TEXT NOT NULL
) ON COMMIT DROP;

WITH source AS (
  SELECT
    st.id,
    st.student_code AS old_code,
    st.school_id,
    upper(btrim(c.iso_code)) AS country_code,
    upper(btrim(s.short_code)) AS school_initials,
    somafrik_student_person_initials(st.last_name, st.first_name) AS person_initials,
    extract(year FROM coalesce(st.created_at, NOW()))::integer AS creation_year,
    st.created_at
  FROM students st
  JOIN schools s ON s.id = st.school_id
  JOIN countries c ON c.id = s.country_id
  WHERE st.student_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
     OR st.login_code IS DISTINCT FROM st.student_code
     OR st.identity_code IS DISTINCT FROM st.student_code
), existing_max AS (
  SELECT
    st.school_id,
    max(right(st.student_code, 5)::integer) AS max_seq
  FROM students st
  WHERE st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
  GROUP BY st.school_id
), ranked AS (
  SELECT
    src.*,
    coalesce(mx.max_seq, 0) + row_number() OVER (
      PARTITION BY src.school_id
      ORDER BY src.created_at NULLS LAST, src.old_code, src.id
    ) AS seq
  FROM source src
  LEFT JOIN existing_max mx ON mx.school_id = src.school_id
)
INSERT INTO student_general_identity_remap (id, old_code, new_code)
SELECT
  id,
  old_code,
  country_code || '-' || school_initials || '-' || person_initials || '-' ||
  lpad((creation_year % 100)::text, 2, '0') || '-' || lpad(seq::text, 5, '0')
FROM ranked
WHERE seq <= 99999;

DO $$
DECLARE expected_count INTEGER; mapped_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO expected_count
  FROM students
  WHERE student_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
     OR login_code IS DISTINCT FROM student_code
     OR identity_code IS DISTINCT FROM student_code;
  SELECT COUNT(*) INTO mapped_count FROM student_general_identity_remap;
  IF expected_count <> mapped_count THEN
    RAISE EXCEPTION 'STUDENT_GENERAL_IDENTITY_BACKFILL_INCOMPLETE: expected %, mapped %', expected_count, mapped_count;
  END IF;
END $$;

UPDATE students st
SET
  student_code = m.new_code,
  login_code = m.new_code,
  identity_code = m.new_code,
  identity_initials = split_part(m.new_code, '-', 3),
  identity_year = 2000 + split_part(m.new_code, '-', 4)::integer,
  updated_at = NOW()
FROM student_general_identity_remap m
WHERE st.id = m.id;

UPDATE users u
SET
  user_code = m.new_code,
  login_code = m.new_code,
  identity_code = m.new_code,
  identity_initials = split_part(m.new_code, '-', 3),
  identity_year = 2000 + split_part(m.new_code, '-', 4)::integer,
  profile_payload = coalesce(u.profile_payload, '{}'::jsonb)
    || jsonb_build_object(
      'identifier', m.new_code,
      'identityCode', m.new_code,
      'legacyIdentifier', m.old_code
    ),
  updated_at = NOW()
FROM students st
JOIN student_general_identity_remap m ON m.id = st.id
WHERE u.school_id = st.school_id
  AND (
    u.user_code = m.old_code
    OR u.login_code = m.old_code
    OR u.identity_code = m.old_code
    OR coalesce(u.profile_payload->>'identifier', '') = m.old_code
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM students
    WHERE student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
    GROUP BY school_id, right(student_code, 5)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'STUDENT_GENERAL_IDENTITY_SEQ_COLLISION';
  END IF;
END $$;

INSERT INTO student_general_code_counters (school_id, last_value)
SELECT
  st.school_id,
  max(right(st.student_code, 5)::integer)
FROM students st
WHERE st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
GROUP BY st.school_id
ON CONFLICT (school_id)
DO UPDATE SET
  last_value = GREATEST(student_general_code_counters.last_value, EXCLUDED.last_value),
  updated_at = NOW();

ALTER TABLE students ENABLE TRIGGER USER;
ALTER TABLE users ENABLE TRIGGER USER;

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_canonical_identifier_format_check;
ALTER TABLE students ADD CONSTRAINT students_canonical_identifier_format_check
  CHECK (
    student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
    AND login_code IS NOT DISTINCT FROM student_code
    AND identity_code IS NOT DISTINCT FROM student_code
  ) NOT VALID;
ALTER TABLE students VALIDATE CONSTRAINT students_canonical_identifier_format_check;

COMMIT;
