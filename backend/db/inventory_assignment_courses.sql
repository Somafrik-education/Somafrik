-- REG-PLANNING-COURS-01 (#1179) — inventaire LECTURE SEULE.
-- À exécuter uniquement avec une connexion PostgreSQL autorisée, après
-- identification de l'UUID d'établissement. Ne répare rien et ne crée rien.
-- Paramètre psql obligatoire : -v school_id='<UUID>'
-- Ex.: psql "$DATABASE_URL" -v school_id='00000000-0000-0000-0000-000000000000' -f backend/db/inventory_assignment_courses.sql
-- N'utiliser que sur environnement autorisé (préproduction d'abord).
BEGIN READ ONLY;

SELECT s.school_code, cl.name AS class_name, sub.name AS subject_name,
       t.teacher_code, ta.id AS assignment_id, ta.academic_year_id,
       sc.id AS school_course_id, sc.teacher_id AS course_teacher_id,
       CASE
         WHEN sc.id IS NULL THEN 'MISSING_CANONICAL_COURSE'
         WHEN sc.teacher_id IS DISTINCT FROM ta.teacher_id THEN 'TEACHER_MISMATCH'
         WHEN COALESCE(t.status, 'active') <> 'active' THEN 'TEACHER_INACTIVE'
         WHEN COALESCE(sub.status, 'active') <> 'active' THEN 'SUBJECT_INACTIVE'
         WHEN COALESCE(cl.status, 'active') <> 'active' THEN 'CLASS_INACTIVE'
         ELSE 'OK'
       END AS diagnostic
FROM teacher_assignments ta
JOIN schools s ON s.id = ta.school_id
JOIN classes cl ON cl.id = ta.class_id AND cl.school_id = ta.school_id
JOIN subjects sub ON sub.id = ta.subject_id AND sub.school_id = ta.school_id
JOIN teachers t ON t.id = ta.teacher_id AND t.school_id = ta.school_id
LEFT JOIN school_courses sc ON sc.school_id = ta.school_id
  AND sc.class_id = ta.class_id AND sc.subject_id = ta.subject_id
  AND sc.status = 'active'
WHERE ta.school_id = :'school_id'::uuid AND ta.status = 'active'
ORDER BY cl.name, sub.name, ta.id;

COMMIT;
