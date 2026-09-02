-- Catalogue pays des groupes / sections de classe + activation établissement.
-- NIVEAU ≠ FILIÈRE/OPTION ≠ GROUPE/SECTION. Aucun backfill silencieux.

CREATE TABLE IF NOT EXISTS education_class_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id),
  group_code TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT education_class_groups_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT education_class_groups_country_code_unique UNIQUE (country_id, group_code)
);

CREATE INDEX IF NOT EXISTS idx_education_class_groups_country_status
  ON education_class_groups (country_id, status, display_order);

CREATE TABLE IF NOT EXISTS school_class_groups (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES education_class_groups(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, group_id),
  CONSTRAINT school_class_groups_status_check CHECK (status IN ('active', 'archived'))
);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES education_class_groups(id);

-- Recrée l'unicité structurelle sur group_id (plus de texte libre group_code).
DROP INDEX IF EXISTS uq_classes_structural_offering;
CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_structural_offering
  ON classes (
    school_id,
    academic_year_id,
    level_id,
    COALESCE(stream_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE level_id IS NOT NULL AND group_id IS NOT NULL;
