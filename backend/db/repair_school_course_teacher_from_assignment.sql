-- Repair strict et idempotent d'un school_course actif sans enseignant
-- à partir d'une unique teacher_assignment active canonique.
-- Ne touche qu'aux lignes où school_courses.teacher_id IS NULL.
-- Fail-closed: aucune mutation si 0 ou >1 affectation candidate.
-- Usage recommandé en SQL editor Supabase:
-- BEGIN;
-- <exécuter ce script>
-- vérifier le RETURNING;
-- COMMIT; -- ou ROLLBACK si besoin

WITH candidate AS (
  SELECT
    sc.id AS school_course_id,
    MIN(ta.teacher_id) AS teacher_id,
    COUNT(*) AS assignment_count
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
  GROUP BY sc.id
),
repairable AS (
  SELECT school_course_id, teacher_id
  FROM candidate
  WHERE assignment_count = 1
)
UPDATE school_courses sc
SET teacher_id = r.teacher_id,
    updated_at = NOW()
FROM repairable r
WHERE sc.id = r.school_course_id
  AND sc.status = 'active'
  AND sc.teacher_id IS NULL
RETURNING sc.id, sc.school_id, sc.class_id, sc.subject_id, sc.teacher_id, sc.course_code, sc.status, sc.updated_at;
