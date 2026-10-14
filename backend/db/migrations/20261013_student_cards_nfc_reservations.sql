-- NFC-PROG-02: extend the canonical registry; no parallel cards or plaintext tokens.
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_operation_id UUID;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_reservation_expires_at TIMESTAMPTZ;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_replaces_card_id UUID;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_retry_operation_ids UUID[] NOT NULL DEFAULT '{}';

-- Upgrade only legacy NFC pending bindings from #909. Preserve UID/history and
-- original issuance time: restarting must never grant another 30 minutes.
UPDATE student_access_cards
   SET status = CASE WHEN status = 'active' THEN 'issued' ELSE status END,
       nfc_operation_id = gen_random_uuid(),
       nfc_reservation_expires_at = issued_at + INTERVAL '30 minutes'
 WHERE nfc_encoding_state = 'pending' AND nfc_operation_id IS NULL;

DO $nfc_reservations$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_access_cards_nfc_reservation_check' AND conrelid = 'student_access_cards'::regclass) THEN
    ALTER TABLE student_access_cards ADD CONSTRAINT student_access_cards_nfc_reservation_check CHECK (
      (nfc_operation_id IS NULL AND nfc_reservation_expires_at IS NULL
       AND nfc_replaces_card_id IS NULL AND cardinality(nfc_retry_operation_ids) = 0)
      OR (nfc_uid IS NOT NULL AND nfc_operation_id IS NOT NULL
       AND nfc_reservation_expires_at IS NOT NULL AND nfc_reservation_expires_at > issued_at)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_access_cards_nfc_pending_nonactive_check' AND conrelid = 'student_access_cards'::regclass) THEN
    ALTER TABLE student_access_cards ADD CONSTRAINT student_access_cards_nfc_pending_nonactive_check CHECK (
      nfc_encoding_state IS DISTINCT FROM 'pending'
      OR (status IN ('issued', 'revoked') AND nfc_operation_id IS NOT NULL
          AND nfc_reservation_expires_at IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_access_cards_nfc_replaces_tenant_fk' AND conrelid = 'student_access_cards'::regclass) THEN
    ALTER TABLE student_access_cards ADD CONSTRAINT student_access_cards_nfc_replaces_tenant_fk
      FOREIGN KEY (school_id, student_id, nfc_replaces_card_id)
      REFERENCES student_access_cards(school_id, student_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_access_cards_nfc_replaces_not_self' AND conrelid = 'student_access_cards'::regclass) THEN
    ALTER TABLE student_access_cards ADD CONSTRAINT student_access_cards_nfc_replaces_not_self
      CHECK (nfc_replaces_card_id IS NULL OR nfc_replaces_card_id <> id);
  END IF;
END $nfc_reservations$;
CREATE UNIQUE INDEX IF NOT EXISTS student_access_cards_nfc_operation_unique
  ON student_access_cards(school_id, nfc_operation_id) WHERE nfc_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS student_access_cards_one_pending_nfc_per_student
  ON student_access_cards(school_id, student_id)
  WHERE status = 'issued' AND nfc_encoding_state = 'pending';
