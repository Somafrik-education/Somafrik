"use strict";

/**
 * Persistance du curseur wizard guidé (pas un statut métier dérivé).
 * Interdit : toute colonne de statut persisté — l'état métier reste dérivé (LOT 0).
 */

const SCHOOL_SETUP_PROGRESS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS school_setup_progress (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  last_valid_step INTEGER NOT NULL DEFAULT 0,
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_setup_progress_last_valid_step_check
    CHECK (last_valid_step >= 0 AND last_valid_step <= 10)
);
`;

async function ensureSchoolSetupGuidedSchema(db) {
  if (!db || typeof db.query !== "function") return;
  await db.query(SCHOOL_SETUP_PROGRESS_TABLE_SQL);
}

module.exports = {
  SCHOOL_SETUP_PROGRESS_TABLE_SQL,
  ensureSchoolSetupGuidedSchema,
};
