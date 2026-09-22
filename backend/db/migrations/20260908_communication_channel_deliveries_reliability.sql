-- Lot K — lease reclaim + observabilité deliveries PUSH/EMAIL.
ALTER TABLE communication_channel_deliveries
  ADD COLUMN IF NOT EXISTS dispatch_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_communication_channel_deliveries_processing
  ON communication_channel_deliveries (status, claimed_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_communication_channel_deliveries_dead_letter
  ON communication_channel_deliveries (status, updated_at)
  WHERE status IN ('dead_letter', 'failed');
