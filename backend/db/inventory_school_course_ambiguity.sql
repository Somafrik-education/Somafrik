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

-- 5. Dry-run SELECT du repair #531 : cours actif teacher_id NULL
--    + exactement une teacher_assignment active canonique. Aucun UPDATE.
SELECT
  sc.id AS school_course_id,
  sc.school_id,
  s.school_code,
  sc.class_id,
  c.class_code,
  sc.subject_id,
  sub.subject_code,
  sc.course_code,
  ta.id AS assignment_id,
  ta.teacher_id AS proposed_teacher_id,
  t.teacher_code AS proposed_teacher_code
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
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
  AND (
    SELECT COUNT(*)::int
    FROM teacher_assignments ta2
    JOIN teachers t2
      ON t2.id = ta2.teacher_id
     AND t2.school_id = ta2.school_id
    JOIN classes c2
      ON c2.id = ta2.class_id
     AND c2.school_id = ta2.school_id
     AND c2.academic_year_id = ta2.academic_year_id
    JOIN subjects sub2
      ON sub2.id = ta2.subject_id
     AND sub2.school_id = ta2.school_id
    JOIN academic_years ay2
      ON ay2.id = ta2.academic_year_id
     AND ay2.school_id = ta2.school_id
    WHERE ta2.school_id = sc.school_id
      AND ta2.class_id = sc.class_id
      AND ta2.subject_id = sc.subject_id
      AND ta2.status = 'active'
      AND lower(COALESCE(t2.status, 'active')) NOT IN ('deleted', 'archived')
  ) = 1
ORDER BY s.school_code, c.class_code, sub.subject_code, sc.id;

-- 6. Compteurs de dépendances (notes / bulletins / planning) — aucun PII
SELECT
  sc.id AS school_course_id,
  s.school_code,
  c.class_code,
  sub.subject_code,
  sc.course_code,
  sc.teacher_id IS NULL AS teacher_id_null,
  (
    SELECT COUNT(*)::int
    FROM course_schedule_weekly_slots w
    WHERE w.school_course_id = sc.id
  ) AS weekly_slot_count,
  (
    SELECT COUNT(*)::int
    FROM course_schedule_slots d
    WHERE d.school_id = sc.school_id
      AND d.class_id = sc.class_id
      AND d.subject_name = sub.name
  ) AS dated_slot_count,
  (
    SELECT COUNT(*)::int
    FROM teacher_assignments ta
    WHERE ta.school_id = sc.school_id
      AND ta.class_id = sc.class_id
      AND ta.subject_id = sc.subject_id
      AND ta.status = 'active'
  ) AS active_assignment_count,
  (
    SELECT COUNT(*)::int
    FROM evaluations e
    WHERE e.school_id = sc.school_id
      AND e.class_id = sc.class_id
      AND e.subject_id = sc.subject_id
  ) AS evaluation_count,
  (
    SELECT COUNT(*)::int
    FROM grades g
    WHERE g.school_id = sc.school_id
      AND g.class_id = sc.class_id
      AND g.subject_id = sc.subject_id
  ) AS grade_count,
  (
    SELECT COUNT(*)::int
    FROM report_cards rc
    WHERE rc.school_id = sc.school_id
      AND rc.class_id = sc.class_id
  ) AS report_card_count
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
JOIN classes c ON c.id = sc.class_id
JOIN subjects sub ON sub.id = sc.subject_id
WHERE sc.status = 'active'
  AND (
    (sc.school_id, sc.class_id, sc.subject_id) IN (
      SELECT school_id, class_id, subject_id
      FROM school_courses
      WHERE status = 'active'
      GROUP BY school_id, class_id, subject_id
      HAVING COUNT(*) > 1
    )
    OR EXISTS (
      SELECT 1
      FROM teacher_assignments ta
      WHERE ta.status = 'active'
        AND ta.school_id = sc.school_id
        AND ta.class_id = sc.class_id
        AND ta.subject_id = sc.subject_id
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
    )
  )
ORDER BY s.school_code, c.class_code, sub.subject_code, sc.id;
