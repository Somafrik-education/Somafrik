-- LOT 2 — Rôles généraux d'établissement canoniques.

CREATE TABLE IF NOT EXISTS establishment_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code TEXT NOT NULL,
  role_name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'school',
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  school_assignable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT establishment_roles_scope_check CHECK (scope IN ('school', 'platform', 'country')),
  CONSTRAINT establishment_roles_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT establishment_roles_role_code_unique UNIQUE (role_code),
  CONSTRAINT establishment_roles_role_name_unique UNIQUE (role_name)
);

CREATE INDEX IF NOT EXISTS idx_establishment_roles_status_order
  ON establishment_roles (status, display_order, role_name);

CREATE TABLE IF NOT EXISTS establishment_role_permissions (
  role_id UUID NOT NULL REFERENCES establishment_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS establishment_role_delegation_permissions (
  role_id UUID NOT NULL REFERENCES establishment_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

-- Note : le retrait de userRoles JSON est exécuté au boot après inventaire propre.
