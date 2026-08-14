-- LOT 3 — Types d'évaluation canoniques scopés par établissement.
-- evaluation_type_id = source de vérité ; evaluations.evaluation_type TEXT = projection/compatibilité.

CREATE TABLE IF NOT EXISTS evaluation_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evaluation_types_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT evaluation_types_school_code_unique UNIQUE (school_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluation_types_school_name_norm
  ON evaluation_types (school_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_evaluation_types_school_status
  ON evaluation_types (school_id, status, display_order);

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS evaluation_type_id UUID REFERENCES evaluation_types(id);

CREATE INDEX IF NOT EXISTS idx_evaluations_evaluation_type_id
  ON evaluations (evaluation_type_id);

-- Note : le retrait de evaluationTypes JSON est exécuté au boot après inventaire propre
-- (voir STRIP_LEGACY_EVALUATION_TYPES_SQL). Aucune migration silencieuse des libellés custom.
