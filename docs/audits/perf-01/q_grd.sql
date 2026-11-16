SELECT g.*, s.school_code, st.student_code, c.name AS class_name, sub.name AS subject_name,
       COALESCE((SELECT sc.coefficient FROM school_courses sc WHERE sc.school_id = g.school_id AND sc.class_id = g.class_id
                 AND sc.subject_id = g.subject_id AND sc.status = 'active' ORDER BY sc.created_at ASC, sc.id ASC LIMIT 1), sub.coefficient) AS subject_coefficient,
       t.teacher_code, tm.name AS term_name, e.title AS evaluation_title,
       e.max_score AS evaluation_max_score, e.coefficient AS evaluation_coefficient,
       e.evaluation_type AS evaluation_type_pg, e.legacy_json_id AS evaluation_legacy_id,
       e.id AS evaluation_uuid, e.evaluation_type_id, et.name AS evaluation_type_name, et.code AS evaluation_type_code
FROM grades g
JOIN schools s ON s.id = g.school_id
JOIN students st ON st.id = g.student_id
JOIN classes c ON c.id = g.class_id
JOIN subjects sub ON sub.id = g.subject_id
JOIN teachers t ON t.id = g.teacher_id
JOIN terms tm ON tm.id = g.term_id
LEFT JOIN evaluations e ON e.id = g.evaluation_id
LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
/*W*/ ORDER BY g.updated_at DESC
