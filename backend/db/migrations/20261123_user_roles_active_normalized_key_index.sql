-- RBAC-LOGIN-01 — affectations actives par clé de rôle canonique.
-- Sert la garde d'archivage (countActiveAssignmentsForRole) : comptage filtré dans
-- PostgreSQL sur somafrik_normalize_role_code(role_key), sans parcours de toutes les
-- affectations. Index partiel : seules les lignes actives non révoquées.
-- Prérequis : somafrik_normalize_role_code (IMMUTABLE) et table user_roles.
-- Idempotent.
CREATE INDEX IF NOT EXISTS idx_user_roles_active_normalized_key
  ON user_roles (somafrik_normalize_role_code(role_key))
  WHERE status = 'active' AND revoked_at IS NULL;
