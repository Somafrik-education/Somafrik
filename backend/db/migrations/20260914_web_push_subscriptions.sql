-- Web Push navigateur : abonnements PushManager par user + école + APP_ENV.
-- Isolation tenant stricte. Aucun secret VAPID dans cette table.

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  backend_environment TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT web_push_subscriptions_endpoint_unique UNIQUE (endpoint),
  CONSTRAINT web_push_subscriptions_backend_environment_check
    CHECK (backend_environment IN ('development', 'preproduction', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_active
  ON web_push_subscriptions (user_id, school_id, backend_environment)
  WHERE revoked_at IS NULL;
