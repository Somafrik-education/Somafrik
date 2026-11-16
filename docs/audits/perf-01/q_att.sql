SELECT a.*, s.login_code, st.student_code, c.name AS class_name, t.teacher_code
FROM attendance a
JOIN schools s ON s.id = a.school_id
JOIN students st ON st.id = a.student_id
LEFT JOIN classes c ON c.id = a.class_id
LEFT JOIN teachers t ON t.id = a.teacher_id
/*W*/ ORDER BY a.attendance_date DESC
