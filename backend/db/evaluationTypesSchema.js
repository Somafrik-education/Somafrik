"use strict";

/**
 * LOT 3 — Types d'évaluation canoniques scopés par établissement.
 *
 * evaluation_type_id sur evaluations = source de vérité.
 * evaluations.evaluation_type TEXT = projection / compatibilité uniquement.
 */

const EVALUATION_TYPES_SCHEMA_SQL = `
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
`;

const STRIP_LEGACY_EVALUATION_TYPES_SQL = `
-- Appliqué uniquement après inventaire legacy propre (boot postgresRepository).
UPDATE school_academic_configs
SET config_payload = config_payload - 'evaluationTypes',
    updated_at = NOW()
WHERE config_payload ? 'evaluationTypes';
`;

async function assertEvaluationTypesSchemaPreflight(db) {
  const schools = await db.one("SELECT to_regclass('public.schools') AS ref");
  const evaluations = await db.one("SELECT to_regclass('public.evaluations') AS ref");
  if (!schools?.ref || !evaluations?.ref) {
    const error = new Error("Schéma de base requis (schools, evaluations) avant evaluation_types.");
    error.code = "EVALUATION_TYPES_SCHEMA_PREFLIGHT";
    throw error;
  }
}

module.exports = {
  EVALUATION_TYPES_SCHEMA_SQL,
  STRIP_LEGACY_EVALUATION_TYPES_SQL,
  assertEvaluationTypesSchemaPreflight,
};
