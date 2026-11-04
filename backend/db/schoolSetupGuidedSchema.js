"use strict";

/**
 * Curseur du wizard guidé, isolé par school_id.
 * L'état métier READY (LOT 0) reste dérivé. Aucune colonne de statut métier.
 * finalized_at est l'horodatage d'une finalisation explicite confirmée.
 * Il ne recalcule pas le pourcentage et n'est pas effacé si les données changent ensuite.
 */

const SCHOOL_SETUP_PROGRESS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS school_setup_progress (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  last_valid_step INTEGER NOT NULL DEFAULT 0,
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ NULL,
  CONSTRAINT school_setup_progress_last_valid_step_check
    CHECK (last_valid_step >= 0 AND last_valid_step <= 10)
);
`;

const SCHOOL_SETUP_PROGRESS_FINALIZED_AT_SQL = `
ALTER TABLE school_setup_progress
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ NULL;
`;

async function ensureSchoolSetupGuidedSchema(db) {
  if (!db || typeof db.query !== "function") return;
  await db.query(SCHOOL_SETUP_PROGRESS_TABLE_SQL);
  await db.query(SCHOOL_SETUP_PROGRESS_FINALIZED_AT_SQL);
}

module.exports = {
  SCHOOL_SETUP_PROGRESS_TABLE_SQL,
  ensureSchoolSetupGuidedSchema,
};
