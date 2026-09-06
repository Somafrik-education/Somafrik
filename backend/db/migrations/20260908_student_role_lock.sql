-- P0 : un users.id lié par students.user_id (fiche active) ne peut plus
-- muter user_roles, sauf INSERT STUDENT (bootstrap d'inscription).
-- Preuve = FK uniquement. Aucun matching par codes. Aucun rewrite métier.

ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

CREATE OR REPLACE FUNCTION somafrik_assert_student_role_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
DECLARE
  target_user_id UUID;
  linked_student_id UUID;
  role_key_norm TEXT;
BEGIN
  target_user_id := COALESCE(NEW.user_id, OLD.user_id);
  IF target_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT st.id
    INTO linked_student_id
  FROM students st
  WHERE st.user_id = target_user_id
    AND COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
  ORDER BY st.id::text
  LIMIT 1;

  IF linked_student_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    role_key_norm := upper(btrim(coalesce(NEW.role_key, '')));
    IF role_key_norm = 'STUDENT' AND COALESCE(NEW.status, 'active') = 'active' AND NEW.revoked_at IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'STUDENT_ROLE_LOCKED: roles of a linked student account cannot be modified'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS user_roles_student_role_lock ON user_roles;
CREATE TRIGGER user_roles_student_role_lock
BEFORE INSERT OR DELETE OR UPDATE OF user_id, school_id, role_key, status, revoked_at ON user_roles
FOR EACH ROW EXECUTE FUNCTION somafrik_assert_student_role_lock();
