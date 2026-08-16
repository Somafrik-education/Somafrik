-- Matrice CRUD canonique scoped (rôle × portée × module).
-- Justification : role_permissions JSONB est global (pas de country_id / school_id / CRUD colonnes / version).
-- establishment_role_permissions est une liste de jetons non scopée.
-- Cette table étend le catalogue establishment_roles (role_code) sans le remplacer.

ALTER TABLE establishment_roles
  ADD COLUMN IF NOT EXISTS system_protected BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS functional_modules (
  module_key TEXT PRIMARY KEY,
  module_name TEXT NOT NULL UNIQUE,
  applies_web BOOLEAN NOT NULL DEFAULT TRUE,
  applies_mobile BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT functional_modules_status_check CHECK (status IN ('active', 'archived'))
);

CREATE TABLE IF NOT EXISTS role_module_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  country_id UUID REFERENCES countries(id),
  school_id UUID REFERENCES schools(id),
  module_key TEXT NOT NULL REFERENCES functional_modules(module_key),
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_read BOOLEAN NOT NULL DEFAULT FALSE,
  can_update BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT role_module_permissions_scope_type_check CHECK (scope_type IN ('global', 'country', 'school')),
  CONSTRAINT role_module_permissions_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT role_module_permissions_scope_shape_check CHECK (
    (scope_type = 'global' AND country_id IS NULL AND school_id IS NULL)
    OR (scope_type = 'country' AND country_id IS NOT NULL AND school_id IS NULL)
    OR (scope_type = 'school' AND school_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS role_module_permissions_unique_active
  ON role_module_permissions (
    role_key,
    scope_type,
    module_key,
    COALESCE(country_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(school_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_role_module_permissions_role_scope
  ON role_module_permissions (role_key, scope_type, school_id, country_id);

CREATE INDEX IF NOT EXISTS idx_role_module_permissions_updated
  ON role_module_permissions (updated_at DESC);
