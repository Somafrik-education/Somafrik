-- PUSH-N1 : appareils / jetons Expo Push (Android). Isolation des environnements.

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
