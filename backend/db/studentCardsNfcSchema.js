"use strict";

const STUDENT_CARDS_NFC_SCHEMA_SQL = `
-- NFC-ENC-01 — extend the canonical card, never create a parallel UID registry.
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_uid TEXT;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_tag_type TEXT;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_encoding_state TEXT;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_encoded_at TIMESTAMPTZ;
ALTER TABLE student_access_cards ADD COLUMN IF NOT EXISTS nfc_locked_at TIMESTAMPTZ;
DO $nfc_constraints$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_access_cards_nfc_check' AND conrelid = 'student_access_cards'::regclass) THEN
    ALTER TABLE student_access_cards ADD CONSTRAINT student_access_cards_nfc_check CHECK (
      (nfc_uid IS NULL AND nfc_tag_type IS NULL AND nfc_encoding_state IS NULL
       AND nfc_encoded_at IS NULL AND nfc_locked_at IS NULL)
      OR (nfc_uid IS NOT NULL AND nfc_uid ~ '^04[0-9A-F]{12}$'
       AND nfc_tag_type IS NOT NULL AND nfc_tag_type IN ('NTAG213', 'NTAG216')
       AND medium IN ('nfc', 'nfc_qr')
       AND nfc_encoding_state IS NOT NULL
       AND ((nfc_encoding_state = 'pending' AND nfc_encoded_at IS NULL AND nfc_locked_at IS NULL)
         OR (nfc_encoding_state = 'encoded' AND nfc_encoded_at IS NOT NULL AND nfc_locked_at IS NULL)
         OR (nfc_encoding_state = 'locked' AND nfc_encoded_at IS NOT NULL AND nfc_locked_at IS NOT NULL)))
    );
  END IF;
END $nfc_constraints$;
-- Historical bindings remain reserved after loss/revocation (never silently reuse a card).
CREATE UNIQUE INDEX IF NOT EXISTS student_access_cards_nfc_uid_unique
  ON student_access_cards(nfc_uid) WHERE nfc_uid IS NOT NULL;
`;

module.exports = { STUDENT_CARDS_NFC_SCHEMA_SQL };
