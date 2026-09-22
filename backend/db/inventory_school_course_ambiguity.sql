-- Inventaire read-only des collisions school_courses (boot CANONICAL_SCHOOL_COURSE_AMBIGUOUS).
-- Aucun INSERT / UPDATE / DELETE / DDL.
-- Usage recommandé : BEGIN READ ONLY dans le SQL editor, puis ROLLBACK.
-- Préférer : DATABASE_URL=... npm run inventory:school-course-ambiguity

-- 0. Index unique actif classe+matière
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = ANY (current_schemas(false))
   AND indexname = 'uq_school_courses_class_subject_active';

-- 1. Groupes actifs (school_id, class_id, subject_id) avec plus d'une ligne
SELECT
  school_id,
  class_id,
  subject_id,
  COUNT(*) AS active_count,
  ARRAY_AGG(id ORDER BY created_at) AS school_course_ids
FROM school_courses
WHERE status = 'active'
GROUP BY school_id, class_id, subject_id
HAVING COUNT(*) > 1
ORDER BY active_count DESC, school_id, class_id, subject_id;

-- 2. Détail des lignes concernées par ces groupes
SELECT
  id,
  school_id,
  class_id,
  subject_id,
  status,
  created_at,
  updated_at
FROM school_courses
WHERE status = 'active'
  AND (school_id, class_id, subject_id) IN (
    SELECT school_id, class_id, subject_id
    FROM school_courses
    WHERE status = 'active'
    GROUP BY school_id, class_id, subject_id
    HAVING COUNT(*) > 1
  )
ORDER BY school_id, class_id, subject_id, created_at, id;

-- 3. Collisions boot même avec index unique : affectation vs cours d'un autre enseignant
--    (ou plusieurs school_courses actifs pour la même classe+matière)
SELECT
  ta.id AS assignment_id,
  ta.school_id,
  ta.teacher_id AS assignment_teacher_id,
  ta.class_id,
  ta.subject_id,
  ta.academic_year_id,
  sc.id AS school_course_id,
  sc.teacher_id AS course_teacher_id,
  sc.course_code,
  sc.status AS course_status,
  sc.created_at AS course_created_at
FROM teacher_assignments ta
JOIN school_courses sc
  ON sc.school_id = ta.school_id
 AND sc.class_id = ta.class_id
 AND sc.subject_id = ta.subject_id
 AND sc.status = 'active'
WHERE ta.status = 'active'
  AND (
    sc.teacher_id IS DISTINCT FROM ta.teacher_id
    OR (
      SELECT COUNT(*)
      FROM school_courses sc2
      WHERE sc2.school_id = ta.school_id
        AND sc2.class_id = ta.class_id
        AND sc2.subject_id = ta.subject_id
        AND sc2.status = 'active'
    ) > 1
  )
ORDER BY ta.school_id, ta.class_id, ta.subject_id, ta.id, sc.id;

-- 4. Affectations actives aux références non canoniques (autre STOP boot)
SELECT
  ta.id AS assignment_id,
  ta.school_id,
  ta.teacher_id,
  ta.class_id,
  ta.subject_id,
  ta.academic_year_id
FROM teacher_assignments ta
LEFT JOIN teachers t ON t.id = ta.teacher_id
LEFT JOIN classes c ON c.id = ta.class_id
LEFT JOIN subjects sub ON sub.id = ta.subject_id
LEFT JOIN academic_years ay ON ay.id = ta.academic_year_id
LEFT JOIN schools s ON s.id = ta.school_id
WHERE ta.status = 'active'
  AND (
    ta.teacher_id IS NULL
    OR ta.class_id IS NULL
    OR ta.subject_id IS NULL
    OR ta.academic_year_id IS NULL
    OR ta.school_id IS NULL
    OR t.id IS NULL
    OR c.id IS NULL
    OR sub.id IS NULL
    OR ay.id IS NULL
    OR s.school_code IS NULL
    OR t.school_id IS DISTINCT FROM ta.school_id
    OR c.school_id IS DISTINCT FROM ta.school_id
    OR sub.school_id IS DISTINCT FROM ta.school_id
    OR ay.school_id IS DISTINCT FROM ta.school_id
    OR c.academic_year_id IS DISTINCT FROM ta.academic_year_id
    OR lower(COALESCE(t.status, 'active')) IN ('deleted', 'archived')
  )
ORDER BY ta.school_id, ta.id;
