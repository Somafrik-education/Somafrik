"use strict";

/**
 * PUSH-N1 — Jetons Expo Push (Android) par utilisateur authentifié.
 * Isolation preview / preproduction / production. Aucun userId client.
 * Receipts Expo persistés pour une vérification différée (~15 min).
 */

const MOBILE_PUSH_DEVICES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mobile_push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  school_id UUID REFERENCES schools(id),
  expo_push_token TEXT NOT NULL,
  platform TEXT NOT NULL,
  release_profile TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_devices_platform_check
    CHECK (platform IN ('android', 'ios')),
  CONSTRAINT mobile_push_devices_release_profile_check
    CHECK (release_profile IN ('development', 'preview', 'preproduction', 'production')),
  CONSTRAINT mobile_push_devices_token_unique UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_user_active
  ON mobile_push_devices (user_id, release_profile)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS mobile_push_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id TEXT NOT NULL,
  expo_push_token TEXT NOT NULL,
  device_id UUID REFERENCES mobile_push_devices(id),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_check_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_at TIMESTAMPTZ,
  CONSTRAINT mobile_push_receipts_status_check
    CHECK (status IN ('pending', 'ok', 'error', 'expired')),
  CONSTRAINT mobile_push_receipts_id_unique UNIQUE (receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_receipts_due
  ON mobile_push_receipts (next_check_at)
  WHERE status = 'pending';
`;

module.exports = {
  MOBILE_PUSH_DEVICES_SCHEMA_SQL,
};
