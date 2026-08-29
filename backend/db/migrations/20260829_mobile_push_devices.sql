-- PUSH-N1 : appareils / jetons Expo Push (Android).
-- Isolation par environnement serveur (APP_ENV) + métadonnée app_profile.
-- Receipts Expo persistés pour une vérification différée (~15 min, TTL 24 h).

CREATE TABLE IF NOT EXISTS mobile_push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  school_id UUID REFERENCES schools(id),
  expo_push_token TEXT NOT NULL,
  platform TEXT NOT NULL,
  backend_environment TEXT,
  app_profile TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_devices_platform_check
    CHECK (platform IN ('android', 'ios')),
  CONSTRAINT mobile_push_devices_token_unique UNIQUE (expo_push_token)
);

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

DO $push_n1$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mobile_push_devices'
      AND column_name = 'release_profile'
  ) THEN
    UPDATE mobile_push_devices
    SET
      app_profile = COALESCE(NULLIF(app_profile, ''), release_profile),
      backend_environment = COALESCE(
        NULLIF(backend_environment, ''),
        CASE
          WHEN release_profile IN ('preview', 'preproduction') THEN 'preproduction'
          WHEN release_profile = 'production' THEN 'production'
          ELSE 'development'
        END
      )
    WHERE app_profile IS NULL OR backend_environment IS NULL;
    ALTER TABLE mobile_push_devices DROP CONSTRAINT IF EXISTS mobile_push_devices_release_profile_check;
    DROP INDEX IF EXISTS idx_mobile_push_devices_user_active;
    ALTER TABLE mobile_push_devices DROP COLUMN release_profile;
  END IF;
END
$push_n1$;

ALTER TABLE mobile_push_devices ADD COLUMN IF NOT EXISTS backend_environment TEXT;
ALTER TABLE mobile_push_devices ADD COLUMN IF NOT EXISTS app_profile TEXT;

UPDATE mobile_push_devices SET backend_environment = 'development' WHERE backend_environment IS NULL;
UPDATE mobile_push_devices SET app_profile = 'development' WHERE app_profile IS NULL;

ALTER TABLE mobile_push_devices ALTER COLUMN backend_environment SET NOT NULL;
ALTER TABLE mobile_push_devices ALTER COLUMN app_profile SET NOT NULL;

ALTER TABLE mobile_push_devices DROP CONSTRAINT IF EXISTS mobile_push_devices_backend_environment_check;
ALTER TABLE mobile_push_devices ADD CONSTRAINT mobile_push_devices_backend_environment_check
  CHECK (backend_environment IN ('development', 'preproduction', 'production'));
ALTER TABLE mobile_push_devices DROP CONSTRAINT IF EXISTS mobile_push_devices_app_profile_check;
ALTER TABLE mobile_push_devices ADD CONSTRAINT mobile_push_devices_app_profile_check
  CHECK (app_profile IN ('development', 'preview', 'preproduction', 'production'));

CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_user_active
  ON mobile_push_devices (user_id, backend_environment)
  WHERE revoked_at IS NULL;
