"use strict";

/**
 * LOT 1 — Référentiels pédagogiques canoniques (niveaux / filières) scopés par pays.
 */

const EDUCATION_REFERENCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS education_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id),
  level_code TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT education_levels_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT education_levels_country_code_unique UNIQUE (country_id, level_code)
);

CREATE INDEX IF NOT EXISTS idx_education_levels_country_status
  ON education_levels (country_id, status, display_order);

CREATE TABLE IF NOT EXISTS education_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id),
  level_id UUID REFERENCES education_levels(id),
  stream_code TEXT NOT NULL,
  name TEXT NOT NULL,
  stream_type TEXT NOT NULL DEFAULT 'filiere',
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT education_streams_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT education_streams_type_check CHECK (stream_type IN ('filiere', 'serie', 'option')),
  CONSTRAINT education_streams_country_code_unique UNIQUE (country_id, stream_code)
);

CREATE INDEX IF NOT EXISTS idx_education_streams_country_type
  ON education_streams (country_id, stream_type, status, display_order);

CREATE TABLE IF NOT EXISTS school_levels (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  level_id UUID NOT NULL REFERENCES education_levels(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, level_id),
  CONSTRAINT school_levels_status_check CHECK (status IN ('active', 'archived'))
);

CREATE TABLE IF NOT EXISTS school_streams (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  stream_id UUID NOT NULL REFERENCES education_streams(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, stream_id),
  CONSTRAINT school_streams_status_check CHECK (status IN ('active', 'archived'))
);

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

-- Libellés UI par pays (concept canonique LEVEL/TRACK/GROUP, affichage configurable).
-- Défauts génériques — pas un vocabulaire national injecté dans tous les pays.
ALTER TABLE countries ADD COLUMN IF NOT EXISTS pedagogical_level_label TEXT NOT NULL DEFAULT 'Niveau';
ALTER TABLE countries ADD COLUMN IF NOT EXISTS pedagogical_track_label TEXT NOT NULL DEFAULT 'Filière';
ALTER TABLE countries ADD COLUMN IF NOT EXISTS pedagogical_group_label TEXT NOT NULL DEFAULT 'Groupe';
`;

const STRIP_LEGACY_ACADEMIC_REFERENCE_SQL = `
-- Appliqué uniquement après inventaire legacy propre (boot postgresRepository).
UPDATE school_academic_configs
SET config_payload = config_payload - 'levels' - 'tracks',
    updated_at = NOW()
WHERE (config_payload ? 'levels') OR (config_payload ? 'tracks');
`;

async function assertEducationReferenceSchemaPreflight(db) {
  const country = await db.one("SELECT to_regclass('public.countries') AS ref");
  const schools = await db.one("SELECT to_regclass('public.schools') AS ref");
  if (!country?.ref || !schools?.ref) {
    const error = new Error("Schéma de base requis (countries, schools) avant education reference.");
    error.code = "EDUCATION_REFERENCE_SCHEMA_PREFLIGHT";
    throw error;
  }
}

module.exports = {
  EDUCATION_REFERENCE_SCHEMA_SQL,
  STRIP_LEGACY_ACADEMIC_REFERENCE_SQL,
  assertEducationReferenceSchemaPreflight,
};
