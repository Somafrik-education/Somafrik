-- P0 : un users.id lié par students.user_id (fiche active) ne peut plus
-- muter user_roles, sauf INSERT STUDENT (bootstrap d'inscription).
-- Preuve = FK uniquement. Aucun matching par codes. Aucun rewrite métier.
--
-- Le trigger est posé APRÈS le backfill boot (20260909). Un BEFORE INSERT
-- déjà installé ferait échouer ON CONFLICT DO NOTHING (P0001 STUDENT_ROLE_LOCKED)
-- et abortirait le démarrage. DROP ici, CREATE dans 20260909.

ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

CREATE OR REPLACE FUNCTION somafrik_linked_active_student_id(target_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path TO pg_catalog, public, pg_temp
AS $$
  SELECT st.id
  FROM students st
  WHERE target_user_id IS NOT NULL
    AND st.user_id = target_user_id
    AND COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
  ORDER BY st.id::text
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION somafrik_assert_student_role_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
DECLARE
  linked_student_id UUID;
  role_key_norm TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF somafrik_linked_active_student_id(OLD.user_id) IS NOT NULL THEN
      RAISE EXCEPTION 'STUDENT_ROLE_LOCKED: roles of a linked student account cannot be modified'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF somafrik_linked_active_student_id(OLD.user_id) IS NOT NULL
       OR somafrik_linked_active_student_id(NEW.user_id) IS NOT NULL THEN
      RAISE EXCEPTION 'STUDENT_ROLE_LOCKED: roles of a linked student account cannot be modified'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  linked_student_id := somafrik_linked_active_student_id(NEW.user_id);
  IF linked_student_id IS NULL THEN
    RETURN NEW;
  END IF;

  role_key_norm := upper(btrim(coalesce(NEW.role_key, '')));
  IF role_key_norm = 'STUDENT' AND COALESCE(NEW.status, 'active') = 'active' AND NEW.revoked_at IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'STUDENT_ROLE_LOCKED: roles of a linked student account cannot be modified'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS user_roles_student_role_lock ON user_roles;
