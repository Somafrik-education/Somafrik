-- Trigger P0 STUDENT_ROLE_LOCKED — après le backfill boot user_roles.
-- Voir 20260908 (fonctions + DROP) et ensureUserRolesCanonicalSchema.

DROP TRIGGER IF EXISTS user_roles_student_role_lock ON user_roles;
CREATE TRIGGER user_roles_student_role_lock
BEFORE INSERT OR DELETE OR UPDATE OF user_id, school_id, role_key, status, revoked_at ON user_roles
FOR EACH ROW EXECUTE FUNCTION somafrik_assert_student_role_lock();
