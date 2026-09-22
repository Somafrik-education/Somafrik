-- Exclusivité profil métier élève ↔ enseignant (même tenant, même users.id).
-- Idempotent. Triggers uniquement : aucun rewrite des doublons existants.
-- Les cas historiques student+teacher sont rapportés par
-- backend/scripts/audit-student-teacher-dual-profiles.js (lecture seule).

CREATE OR REPLACE FUNCTION somafrik_assert_business_profile_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
DECLARE
  target_user_id UUID;
  target_school_id UUID;
  student_code_hit TEXT;
  teacher_code_hit TEXT;
  role_key_norm TEXT;
BEGIN
  IF TG_TABLE_NAME = 'teachers' THEN
    IF NEW.user_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF COALESCE(NEW.status, 'active') IN ('inactive', 'deleted', 'archived') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND COALESCE(NEW.status, 'active') IS NOT DISTINCT FROM COALESCE(OLD.status, 'active')
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.school_id IS NOT DISTINCT FROM OLD.school_id THEN
      RETURN NEW;
    END IF;

    SELECT st.student_code
      INTO student_code_hit
    FROM students st
    JOIN users u ON u.school_id = st.school_id
      AND (
        st.student_code = u.user_code
        OR st.student_code = NULLIF(to_jsonb(u)->>'identity_code', '')
        OR st.student_code = NULLIF(to_jsonb(u)->>'login_code', '')
      )
    WHERE u.id = NEW.user_id
      AND st.school_id = NEW.school_id
      AND COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
    LIMIT 1;

    IF student_code_hit IS NOT NULL THEN
      RAISE EXCEPTION 'BUSINESS_PROFILE_CONFLICT: student % cannot receive teacher profile', student_code_hit
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'user_roles' THEN
    IF COALESCE(NEW.status, 'active') <> 'active' OR NEW.revoked_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    role_key_norm := upper(btrim(coalesce(NEW.role_key, '')));
    target_user_id := NEW.user_id;
    target_school_id := NEW.school_id;

    IF target_school_id IS NULL THEN
      SELECT school_id INTO target_school_id FROM users WHERE id = target_user_id;
    END IF;
    IF target_user_id IS NULL OR target_school_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF role_key_norm = 'TEACHER' THEN
      SELECT st.student_code
        INTO student_code_hit
      FROM students st
      JOIN users u ON u.school_id = st.school_id
        AND (
          st.student_code = u.user_code
          OR st.student_code = NULLIF(to_jsonb(u)->>'identity_code', '')
          OR st.student_code = NULLIF(to_jsonb(u)->>'login_code', '')
        )
      WHERE u.id = target_user_id
        AND st.school_id = target_school_id
        AND COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
      LIMIT 1;
      IF student_code_hit IS NOT NULL THEN
        RAISE EXCEPTION 'BUSINESS_PROFILE_CONFLICT: student % cannot receive TEACHER role', student_code_hit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF role_key_norm = 'STUDENT' THEN
      SELECT t.teacher_code
        INTO teacher_code_hit
      FROM teachers t
      WHERE t.user_id = target_user_id
        AND t.school_id = target_school_id
        AND COALESCE(t.status, 'active') NOT IN ('inactive', 'deleted', 'archived')
      LIMIT 1;
      IF teacher_code_hit IS NOT NULL THEN
        RAISE EXCEPTION 'BUSINESS_PROFILE_CONFLICT: teacher % cannot receive STUDENT role', teacher_code_hit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teachers_business_profile_exclusivity ON teachers;
CREATE TRIGGER teachers_business_profile_exclusivity
BEFORE INSERT OR UPDATE OF user_id, school_id, status ON teachers
FOR EACH ROW EXECUTE FUNCTION somafrik_assert_business_profile_exclusivity();

DROP TRIGGER IF EXISTS user_roles_business_profile_exclusivity ON user_roles;
CREATE TRIGGER user_roles_business_profile_exclusivity
BEFORE INSERT OR UPDATE OF user_id, school_id, role_key, status, revoked_at ON user_roles
FOR EACH ROW EXECUTE FUNCTION somafrik_assert_business_profile_exclusivity();
