SELECT p.*, s.school_code, s.login_code, st.student_code
FROM payments p JOIN schools s ON s.id = p.school_id JOIN students st ON st.id = p.student_id
/*W*/ ORDER BY p.created_at
