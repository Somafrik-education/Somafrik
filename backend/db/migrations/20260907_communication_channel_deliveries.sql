-- COM-C4 — livraisons PUSH/EMAIL après persist in-app (fan-out découplé).
CREATE TABLE IF NOT EXISTS communication_channel_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_key TEXT NOT NULL UNIQUE,
  event_key TEXT NOT NULL,
  notification_id UUID REFERENCES communication_notifications(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  user_id UUID NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('PUSH', 'EMAIL')),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  provider_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communication_channel_deliveries_pending
  ON communication_channel_deliveries (status, available_at, channel)
  WHERE status IN ('pending', 'failed');
