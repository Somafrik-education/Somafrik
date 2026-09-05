-- Lien durable students.user_id → users.id.
-- Le matching par codes (user_code / identity_code / login_code) reste un filet
-- secondaire : un trigger d'identité staff peut diverger du matricule élève.

ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

CREATE UNIQUE INDEX IF NOT EXISTS students_user_id_unique
  ON students (user_id)
  WHERE user_id IS NOT NULL;

-- 1) Backfill par égalité de codes (même établissement).
UPDATE students st
SET user_id = u.id
FROM users u
WHERE st.user_id IS NULL
  AND u.school_id = st.school_id
  AND (
    st.student_code = u.user_code
    OR st.student_code = NULLIF(to_jsonb(u)->>'identity_code', '')
    OR st.student_code = NULLIF(to_jsonb(u)->>'login_code', '')
    OR NULLIF(to_jsonb(st)->>'identity_code', '') = u.user_code
    OR NULLIF(to_jsonb(st)->>'login_code', '') = u.user_code
  )
  AND NOT EXISTS (
    SELECT 1 FROM students other WHERE other.user_id = u.id AND other.id <> st.id
  );

-- 2) Backfill conservateur : un seul élève actif et un seul compte STUDENT
--    de même identité civile dans l'établissement (parcours classe orphelin).
UPDATE students st
SET user_id = u.id
FROM users u
WHERE st.user_id IS NULL
  AND u.school_id = st.school_id
  AND COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
  AND COALESCE(u.status, 'active') NOT IN ('deleted', 'archived')
  AND upper(btrim(coalesce(u.role, ''))) IN ('STUDENT', 'ÉLÈVE / ÉTUDIANT', 'ELEVE / ETUDIANT')
  AND lower(btrim(coalesce(u.first_name, ''))) = lower(btrim(coalesce(st.first_name, '')))
  AND lower(btrim(coalesce(u.last_name, ''))) = lower(btrim(coalesce(st.last_name, '')))
  AND NOT EXISTS (
    SELECT 1 FROM students other WHERE other.user_id = u.id
  )
  AND (
    SELECT count(*) FROM students s2
    WHERE s2.school_id = st.school_id
      AND lower(btrim(coalesce(s2.first_name, ''))) = lower(btrim(coalesce(st.first_name, '')))
      AND lower(btrim(coalesce(s2.last_name, ''))) = lower(btrim(coalesce(st.last_name, '')))
      AND COALESCE(s2.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
  ) = 1
  AND (
    SELECT count(*) FROM users u2
    WHERE u2.school_id = u.school_id
      AND upper(btrim(coalesce(u2.role, ''))) IN ('STUDENT', 'ÉLÈVE / ÉTUDIANT', 'ELEVE / ETUDIANT')
      AND lower(btrim(coalesce(u2.first_name, ''))) = lower(btrim(coalesce(u.first_name, '')))
      AND lower(btrim(coalesce(u2.last_name, ''))) = lower(btrim(coalesce(u.last_name, '')))
      AND COALESCE(u2.status, 'active') NOT IN ('deleted', 'archived')
  ) = 1;
