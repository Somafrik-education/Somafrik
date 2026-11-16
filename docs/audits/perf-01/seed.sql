-- PERF-01 : jeu synthétique local (aucune donnée réelle). 1 appel = 1 établissement.
INSERT INTO countries (name, iso_code, phone_code, currency)
SELECT 'Pays Perf', 'PF', '+999', 'XAF'
WHERE NOT EXISTS (SELECT 1 FROM countries WHERE iso_code = 'PF');

CREATE OR REPLACE FUNCTION perf_seed_school(n int, nstudents int DEFAULT 500, ndays int DEFAULT 120)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  sid uuid; ay uuid; t1 uuid; c uuid;
BEGIN
  INSERT INTO schools (country_id, school_code, name)
  VALUES ((SELECT id FROM countries WHERE iso_code='PF'), 'PERF' || n, 'Ecole perf ' || n)
  RETURNING id INTO sid;
  INSERT INTO academic_years (school_id, name) VALUES (sid, '2026-2027') RETURNING id INTO ay;
  INSERT INTO terms (academic_year_id, name) SELECT ay, 'T' || g FROM generate_series(1,3) g;
  SELECT id INTO t1 FROM terms WHERE academic_year_id = ay ORDER BY name LIMIT 1;

  INSERT INTO classes (school_id, academic_year_id, class_code, name)
  SELECT sid, ay, 'P' || n || 'C' || g, 'Classe ' || g FROM generate_series(1,10) g;
  INSERT INTO subjects (school_id, subject_code, name)
  SELECT sid, 'P' || n || 'S' || g, 'Matiere ' || g FROM generate_series(1,8) g;

  INSERT INTO users (user_code, first_name, last_name, school_id)
  SELECT 'P' || n || 'U' || g, 'Prof', 'N' || g, sid FROM generate_series(1,10) g;
  INSERT INTO teachers (school_id, teacher_code, user_id)
  SELECT sid, 'P' || n || 'T' || g, u.id
  FROM generate_series(1,10) g JOIN users u ON u.user_code = 'P' || n || 'U' || g;

  INSERT INTO students (school_id, student_code, first_name, last_name)
  SELECT sid, 'P' || n || 'E' || g, 'Prenom' || g, 'Nom' || g FROM generate_series(1, nstudents) g;
  INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id)
  SELECT sid, st.id,
         (SELECT id FROM classes WHERE school_id = sid ORDER BY class_code
          OFFSET (substring(st.student_code from 'E([0-9]+)$')::int % 10) LIMIT 1), ay
  FROM students st WHERE st.school_id = sid;

  -- Présences : 1 ligne / élève / jour ouvré (année entamée).
  INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
  SELECT sid, en.student_id, en.class_id, DATE '2026-09-01' + d,
         CASE WHEN random() < 0.93 THEN 'present' ELSE 'absent' END
  FROM enrollments en CROSS JOIN generate_series(0, ndays - 1) d
  WHERE en.school_id = sid;

  -- 3 évaluations / classe / matière sur T1, 1 note / élève / évaluation.
  INSERT INTO evaluations (school_id, class_id, subject_id, term_id, title, teacher_id, max_score, coefficient)
  SELECT sid, cl.id, sb.id, t1, 'Eval ' || k,
         (SELECT id FROM teachers WHERE school_id = sid LIMIT 1), 20, 1
  FROM classes cl CROSS JOIN subjects sb CROSS JOIN generate_series(1,3) k
  WHERE cl.school_id = sid AND sb.school_id = sid;

  INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, grade_type,
                      evaluation_id, score, max_score, grade_status)
  SELECT sid, st.student_id, e.class_id, e.subject_id, e.teacher_id, t1, 'devoir', e.id,
         round((random() * 20)::numeric, 2), 20, 'graded'
  FROM evaluations e JOIN enrollments st ON st.class_id = e.class_id
  WHERE e.school_id = sid;

  INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status)
  SELECT sid, st.id, 'P' || n || 'PAY' || st.student_code || '-' || k, 25000, 'XAF', 'cash', 'paid'
  FROM students st CROSS JOIN generate_series(1,3) k WHERE st.school_id = sid;
END $$;
