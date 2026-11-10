-- NFC-P0-R2: recovery metadata on the canonical card row (no parallel registry).
-- Additive and idempotent: existing rows get count 0 and no expiry timestamp.
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_recovery_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_last_expired_at TIMESTAMPTZ;
DO $nfc_recovery$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_access_cards_nfc_recovery_check' AND conrelid = 'student_access_cards'::regclass) THEN
    ALTER TABLE student_access_cards ADD CONSTRAINT student_access_cards_nfc_recovery_check CHECK (
      nfc_recovery_count >= 0
      AND (nfc_recovery_count = 0 OR nfc_uid IS NOT NULL)
      AND (nfc_last_expired_at IS NULL OR nfc_uid IS NOT NULL)
    );
  END IF;
END $nfc_recovery$;
