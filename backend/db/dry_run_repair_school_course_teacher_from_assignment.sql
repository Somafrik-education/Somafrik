-- DRY-RUN SELECT-only du repair #531.
-- CTE identique à repair_school_course_teacher_from_assignment.sql.
-- Aucune mutation. Lecture seule.
-- Usage recommandé (Supabase SQL editor, rôle lecture) :
-- BEGIN READ ONLY;
-- <exécuter ce script>
-- vérifier row count (attendu prod A1 = 2 ; préprod = 0) ;
-- ROLLBACK;

WITH candidates AS (
  SELECT
    sc.id AS school_course_id,
    ta.teacher_id,
    COUNT(*) OVER (PARTITION BY sc.id) AS assignment_count
  FROM school_courses sc
  JOIN teacher_assignments ta
    ON ta.school_id = sc.school_id
   AND ta.class_id = sc.class_id
   AND ta.subject_id = sc.subject_id
   AND ta.status = 'active'
  JOIN teachers t
    ON t.id = ta.teacher_id
   AND t.school_id = ta.school_id
  JOIN classes c
    ON c.id = ta.class_id
   AND c.school_id = ta.school_id
   AND c.academic_year_id = ta.academic_year_id
  JOIN subjects sub
    ON sub.id = ta.subject_id
   AND sub.school_id = ta.school_id
  JOIN academic_years ay
    ON ay.id = ta.academic_year_id
   AND ay.school_id = ta.school_id
  WHERE sc.status = 'active'
    AND sc.teacher_id IS NULL
    AND lower(COALESCE(t.status, 'active')) NOT IN ('deleted', 'archived')
),
repairable AS (
  SELECT school_course_id, teacher_id
  FROM candidates
  WHERE assignment_count = 1
)
SELECT
  sc.id,
  sc.school_id,
  sc.class_id,
  sc.subject_id,
  sc.teacher_id AS current_teacher_id,
  r.teacher_id AS proposed_teacher_id,
  sc.course_code,
  sc.status
FROM school_courses sc
JOIN repairable r ON sc.id = r.school_course_id
WHERE sc.status = 'active'
  AND sc.teacher_id IS NULL
ORDER BY sc.id;
