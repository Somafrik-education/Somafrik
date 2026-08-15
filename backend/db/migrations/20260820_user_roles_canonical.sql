-- Comptes utilisateurs V2 — identité ≠ rôle ≠ profil métier
-- Idempotent. Inventaire fail-closed AVANT contrainte (voir userRolesSchema.js).

ALTER TABLE users ALTER COLUMN role DROP NOT NULL;

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  school_id UUID REFERENCES schools(id),
  role_key TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_roles_status_check CHECK (status IN ('active', 'revoked')),
  CONSTRAINT user_roles_revoked_consistency CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active_school_unique
  ON user_roles (user_id, school_id, role_key)
  WHERE status = 'active' AND revoked_at IS NULL AND school_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active_platform_unique
  ON user_roles (user_id, role_key)
  WHERE status = 'active' AND revoked_at IS NULL AND school_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_school ON user_roles (school_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_key ON user_roles (role_key);

CREATE TABLE IF NOT EXISTS user_code_counters (
  year INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE establishment_roles
SET school_assignable = FALSE, updated_at = NOW()
WHERE role_code IN ('PARENT', 'STUDENT')
   OR role_name IN ('Parent', 'Élève / Étudiant');
