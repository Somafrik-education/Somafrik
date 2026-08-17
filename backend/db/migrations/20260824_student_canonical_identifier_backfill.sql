-- Backfill opt-in : matricules élèves legacy → {ISO}-{INITIALES}-EL-{YY}-{SEQ3}
-- NE PAS inclure dans USER_ROLES_SCHEMA_SQL (boot).
-- Exécuter uniquement via :
--   node backend/scripts/backfill-student-canonical-identifier.js --apply
--   ou SOMAFRIK_STUDENT_CANONICAL_BACKFILL=1
--
-- Fail-safe :
--   - refuse si un namespace dépasserait 999
--   - refuse de valider le CHECK s'il reste des lignes non canoniques
--   - triggers USER désactivés le temps du rewrite
--   - une seule transaction (ROLLBACK si CHECK incomplet)

BEGIN;

ALTER TABLE students DISABLE TRIGGER USER;
ALTER TABLE users DISABLE TRIGGER USER;

CREATE TABLE IF NOT EXISTS student_code_remap (
  id UUID PRIMARY KEY,
  old_code TEXT NOT NULL
);
DELETE FROM student_code_remap;
INSERT INTO student_code_remap (id, old_code)
SELECT id, student_code FROM students;

DO $$
DECLARE
  overflow INTEGER;
BEGIN
  WITH namespace AS (
    SELECT
      s.country_id,
      CASE
        WHEN coalesce(s.login_code, '') ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
          THEN split_part(s.login_code, '-', 2)
        WHEN nullif(btrim(s.short_code), '') IS NOT NULL THEN upper(btrim(s.short_code))
        ELSE somafrik_school_short_code(s.name)
      END AS school_initials,
      extract(year FROM coalesce(st.created_at, NOW()))::integer AS creation_year,
      st.student_code
    FROM students st
    JOIN schools s ON s.id = st.school_id
  ),
  existing_max AS (
    SELECT country_id, school_initials, creation_year, max(right(student_code, 3)::integer) AS max_seq
    FROM namespace
    WHERE student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
    GROUP BY 1, 2, 3
  ),
  legacy_count AS (
    SELECT country_id, school_initials, creation_year, count(*)::integer AS n
    FROM namespace
    WHERE student_code IS NULL
       OR student_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
    GROUP BY 1, 2, 3
  )
  SELECT COUNT(*) INTO overflow
  FROM legacy_count l
  LEFT JOIN existing_max m
    ON m.country_id = l.country_id
   AND m.school_initials = l.school_initials
   AND m.creation_year = l.creation_year
  WHERE coalesce(m.max_seq, 0) + l.n > 999;
  IF overflow > 0 THEN
    RAISE EXCEPTION 'STUDENT_SEQUENCE_EXHAUSTED: % namespace(s) > 999', overflow;
  END IF;
END $$;

WITH namespace AS (
  SELECT
    st.id,
    s.country_id,
    upper(btrim(c.iso_code)) AS iso_code,
    CASE
      WHEN coalesce(s.login_code, '') ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
        THEN split_part(s.login_code, '-', 2)
      WHEN nullif(btrim(s.short_code), '') IS NOT NULL THEN upper(btrim(s.short_code))
      ELSE somafrik_school_short_code(s.name)
    END AS school_initials,
    extract(year FROM coalesce(st.created_at, NOW()))::integer AS creation_year,
    st.student_code,
    st.created_at
  FROM students st
  JOIN schools s ON s.id = st.school_id
  JOIN countries c ON c.id = s.country_id
),
existing_max AS (
  SELECT country_id, school_initials, creation_year, max(right(student_code, 3)::integer) AS max_seq
  FROM namespace
  WHERE student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
  GROUP BY 1, 2, 3
),
ranked AS (
  SELECT
    n.id,
    n.iso_code,
    n.school_initials,
    n.creation_year,
    coalesce(m.max_seq, 0) + row_number() OVER (
      PARTITION BY n.country_id, n.school_initials, n.creation_year
      ORDER BY n.created_at NULLS LAST, n.student_code, n.id
    ) AS sequence_value
  FROM namespace n
  LEFT JOIN existing_max m
    ON m.country_id = n.country_id
   AND m.school_initials = n.school_initials
   AND m.creation_year = n.creation_year
  WHERE n.student_code IS NULL
     OR n.student_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
)
UPDATE students st
SET
  student_code = somafrik_student_canonical_code(
    r.iso_code, r.school_initials, r.creation_year, r.sequence_value::integer
  ),
  login_code = somafrik_student_canonical_code(
    r.iso_code, r.school_initials, r.creation_year, r.sequence_value::integer
  ),
  identity_code = somafrik_student_canonical_code(
    r.iso_code, r.school_initials, r.creation_year, r.sequence_value::integer
  ),
  identity_initials = 'EL',
  identity_year = r.creation_year
FROM ranked r
WHERE st.id = r.id;

UPDATE students
SET
  login_code = student_code,
  identity_code = student_code,
  identity_initials = coalesce(identity_initials, 'EL'),
  identity_year = coalesce(identity_year, extract(year FROM coalesce(created_at, NOW()))::integer)
WHERE student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
  AND (
    login_code IS DISTINCT FROM student_code
    OR identity_code IS DISTINCT FROM student_code
  );

INSERT INTO student_login_code_counters (country_id, school_initials, creation_year, last_value)
SELECT
  s.country_id,
  CASE
    WHEN coalesce(s.login_code, '') ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
      THEN split_part(s.login_code, '-', 2)
    WHEN nullif(btrim(s.short_code), '') IS NOT NULL THEN upper(btrim(s.short_code))
    ELSE somafrik_school_short_code(s.name)
  END,
  extract(year FROM coalesce(st.created_at, NOW()))::integer,
  max(right(st.student_code, 3)::integer)
FROM students st
JOIN schools s ON s.id = st.school_id
WHERE st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
GROUP BY 1, 2, 3
ON CONFLICT (country_id, school_initials, creation_year)
DO UPDATE SET
  last_value = GREATEST(student_login_code_counters.last_value, EXCLUDED.last_value),
  updated_at = NOW();

UPDATE users u
SET
  user_code = st.student_code,
  login_code = st.student_code,
  identity_code = st.student_code,
  identity_initials = 'EL',
  identity_year = st.identity_year,
  profile_payload = coalesce(u.profile_payload, '{}'::jsonb)
    || jsonb_build_object('identifier', st.student_code, 'identityCode', st.student_code)
FROM students st
JOIN student_code_remap m ON m.id = st.id
WHERE u.school_id = st.school_id
  AND (
    u.user_code = m.old_code
    OR u.user_code = st.student_code
    OR coalesce(u.profile_payload->>'identifier', '') = m.old_code
    OR coalesce(u.login_code, '') = m.old_code
  );

ALTER TABLE students ENABLE TRIGGER USER;
ALTER TABLE users ENABLE TRIGGER USER;

DROP TABLE IF EXISTS student_code_remap;

DO $$
DECLARE leftover INTEGER;
BEGIN
  SELECT COUNT(*) INTO leftover
  FROM students
  WHERE student_code IS NULL
     OR student_code !~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
     OR login_code IS DISTINCT FROM student_code
     OR identity_code IS DISTINCT FROM student_code;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'STUDENT_CANONICAL_BACKFILL_INCOMPLETE: % ligne(s) non canonique(s)', leftover;
  END IF;
END $$;

ALTER TABLE students VALIDATE CONSTRAINT students_canonical_identifier_format_check;

COMMIT;
