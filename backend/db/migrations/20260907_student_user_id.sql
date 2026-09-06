-- Lien durable students.user_id → users.id.
-- Le matching par codes (user_code / identity_code / login_code) reste un filet
-- secondaire : un trigger d'identité staff peut diverger du matricule élève.
--
-- Fail-safe boot : un UPDATE réévalue students_canonical_identifier_format_check
-- même si la contrainte est NOT VALID et même si student_code n'est pas modifié
-- (23514). Les lignes historiques hors CHECK sont exclues du backfill, sans
-- DROP/VALIDATE, sans réécriture d'identité.

ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

CREATE UNIQUE INDEX IF NOT EXISTS students_user_id_unique
  ON students (user_id)
  WHERE user_id IS NOT NULL;

-- Ligne déjà acceptable pour la CHECK (colonnes absentes = filet schémas IT).
-- Ne pas COALESCE(NULL → student_code) : un login_code NULL existant viole la CHECK.
DO $$
DECLARE
  skipped int;
BEGIN
  SELECT count(*) INTO skipped
  FROM students st
  WHERE st.user_id IS NULL
    AND NOT (
      (
        st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
        OR st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
      )
      AND (
        NOT (to_jsonb(st) ? 'login_code')
        OR NULLIF(to_jsonb(st)->>'login_code', '') IS NOT DISTINCT FROM st.student_code
      )
      AND (
        NOT (to_jsonb(st) ? 'identity_code')
        OR NULLIF(to_jsonb(st)->>'identity_code', '') IS NOT DISTINCT FROM st.student_code
      )
    );
  IF skipped > 0 THEN
    RAISE NOTICE '20260907: % student(s) historiques exclus du backfill user_id (CHECK canonique, audit read-only)', skipped;
  END IF;
END $$;

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
  AND (
    st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
    OR st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
  )
  AND (
    NOT (to_jsonb(st) ? 'login_code')
    OR NULLIF(to_jsonb(st)->>'login_code', '') IS NOT DISTINCT FROM st.student_code
  )
  AND (
    NOT (to_jsonb(st) ? 'identity_code')
    OR NULLIF(to_jsonb(st)->>'identity_code', '') IS NOT DISTINCT FROM st.student_code
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
  AND (
    st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$'
    OR st.student_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$'
  )
  AND (
    NOT (to_jsonb(st) ? 'login_code')
    OR NULLIF(to_jsonb(st)->>'login_code', '') IS NOT DISTINCT FROM st.student_code
  )
  AND (
    NOT (to_jsonb(st) ? 'identity_code')
    OR NULLIF(to_jsonb(st)->>'identity_code', '') IS NOT DISTINCT FROM st.student_code
  )
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
