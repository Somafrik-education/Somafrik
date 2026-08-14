"use strict";

/**
 * LOT 8 — Persistance canonique des domaines résiduels (hors snapshot JSON global).
 * academicConfigs, exams, bulletins, documents — aucun backfill depuis backoffice_state.
 */

const RESIDUAL_STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS school_academic_configs (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  config_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS establishment_residual_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  record_domain TEXT NOT NULL CHECK (record_domain IN ('exam', 'bulletin', 'document')),
  legacy_json_id TEXT NOT NULL,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, record_domain, legacy_json_id)
);

CREATE INDEX IF NOT EXISTS idx_residual_records_school_domain
  ON establishment_residual_records (school_id, record_domain)
  WHERE archived_at IS NULL;
`;

module.exports = {
  RESIDUAL_STATE_SCHEMA_SQL,
};
