-- PR-0 — Inventaire lecture seule des référentiels pédagogiques.
-- Aucun INSERT / UPDATE / DELETE / DDL.
-- Usage :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY;" \
--     -f backend/db/inventory_pedagogical_reference.sql \
--     -c "ROLLBACK;"
-- Préférer le runner Node (transaction READ ONLY + matrice + STOP).

-- 1. education_streams
SELECT es.id,
       c.iso_code AS country_code,
       c.name AS country_name,
       es.name,
       es.stream_type,
       es.level_id,
       el.name AS level_name,
       es.stream_code,
       es.status
  FROM education_streams es
  JOIN countries c ON c.id = es.country_id
  LEFT JOIN education_levels el ON el.id = es.level_id
 ORDER BY c.iso_code, es.stream_type, es.name;

-- 2. education_class_groups
SELECT eg.id,
       c.iso_code AS country_code,
       c.name AS country_name,
       eg.group_code,
       eg.name,
       eg.status
  FROM education_class_groups eg
  JOIN countries c ON c.id = eg.country_id
 ORDER BY c.iso_code, eg.display_order, eg.group_code;

-- 3. school_streams — activations établissement
SELECT s.school_code,
       s.name AS school_name,
       c.iso_code AS country_code,
       es.id AS stream_id,
       es.name AS stream_name,
       es.stream_type,
       ss.status AS activation_status
  FROM school_streams ss
  JOIN schools s ON s.id = ss.school_id
  JOIN countries c ON c.id = s.country_id
  JOIN education_streams es ON es.id = ss.stream_id
 ORDER BY s.school_code, es.stream_type, es.name;

-- 4. school_class_groups — activations établissement
SELECT s.school_code,
       s.name AS school_name,
       c.iso_code AS country_code,
       eg.id AS group_id,
       eg.group_code,
       eg.name AS group_name,
       sg.status AS activation_status
  FROM school_class_groups sg
  JOIN schools s ON s.id = sg.school_id
  JOIN countries c ON c.id = s.country_id
  JOIN education_class_groups eg ON eg.id = sg.group_id
 ORDER BY s.school_code, eg.display_order, eg.group_code;

-- 5. classes
SELECT cl.class_code,
       s.school_code,
       ay.name AS academic_year_name,
       cl.level_id,
       el.name AS level_name,
       cl.stream_id,
       es.name AS stream_name,
       es.stream_type,
       cl.group_id,
       cl.group_code,
       eg.name AS group_name,
       cl.name AS class_name,
       cl.status
  FROM classes cl
  JOIN schools s ON s.id = cl.school_id
  LEFT JOIN academic_years ay ON ay.id = cl.academic_year_id
  LEFT JOIN education_levels el ON el.id = cl.level_id
  LEFT JOIN education_streams es ON es.id = cl.stream_id
  LEFT JOIN education_class_groups eg ON eg.id = cl.group_id
 ORDER BY s.school_code, ay.name, cl.class_code;

-- 6. classes sans groupe
SELECT COUNT(*)::int AS classes_group_id_null
  FROM classes
 WHERE group_id IS NULL;

-- 7. doublons structurels déjà possibles hors index (group_id NULL)
SELECT s.school_code,
       ay.name AS academic_year_name,
       cl.level_id,
       el.name AS level_name,
       cl.stream_id,
       es.name AS stream_name,
       COUNT(*)::int AS duplicate_count,
       ARRAY_AGG(cl.class_code ORDER BY cl.class_code) AS class_codes
  FROM classes cl
  JOIN schools s ON s.id = cl.school_id
  LEFT JOIN academic_years ay ON ay.id = cl.academic_year_id
  LEFT JOIN education_levels el ON el.id = cl.level_id
  LEFT JOIN education_streams es ON es.id = cl.stream_id
 WHERE cl.group_id IS NULL
   AND cl.level_id IS NOT NULL
 GROUP BY s.school_code, ay.name, cl.level_id, el.name, cl.stream_id, es.name
HAVING COUNT(*) > 1
 ORDER BY s.school_code, ay.name, el.name, es.name;
