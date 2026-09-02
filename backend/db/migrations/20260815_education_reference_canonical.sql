-- LOT 1 — Référentiels pédagogiques Superadmin (niveaux / filières) scopés par pays.

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

-- Note : le retrait des clés legacy levels/tracks de school_academic_configs est exécuté
-- au boot uniquement après inventaire propre (voir STRIP_LEGACY_ACADEMIC_REFERENCE_SQL).
