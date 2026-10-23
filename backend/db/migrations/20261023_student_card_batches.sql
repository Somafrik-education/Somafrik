-- CARTE-BATCH-API-02 — préparation d'un lot QR sans activation.
-- Aucun secret, jeton complet ou nonce de livraison en clair : uniquement des empreintes SHA-256.
-- Une carte préparée reste `issued` (non scannable) jusqu'à l'activation explicite.

CREATE TABLE IF NOT EXISTS student_card_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  class_code TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  delivery_nonce_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  aborted_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_card_batches_status_check CHECK (
    status IN ('prepared', 'received', 'saved', 'activated', 'expired', 'aborted')
  ),
  CONSTRAINT student_card_batches_nonce_hash_check
    CHECK (delivery_nonce_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT student_card_batches_phase_check CHECK (
    (status = 'prepared' AND received_at IS NULL AND saved_at IS NULL AND activated_at IS NULL AND aborted_at IS NULL)
    OR (status = 'received' AND received_at IS NOT NULL AND saved_at IS NULL AND activated_at IS NULL AND aborted_at IS NULL)
    OR (status = 'saved' AND received_at IS NOT NULL AND saved_at IS NOT NULL AND activated_at IS NULL AND aborted_at IS NULL)
    OR (status = 'activated' AND received_at IS NOT NULL AND saved_at IS NOT NULL AND activated_at IS NOT NULL AND aborted_at IS NULL)
    OR (status = 'expired' AND activated_at IS NULL AND aborted_at IS NULL)
    OR (status = 'aborted' AND aborted_at IS NOT NULL AND activated_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS student_card_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES student_card_batches(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL,
  card_id UUID NOT NULL,
  outcome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_card_batch_items_outcome_check CHECK (
    outcome IN ('prepared', 'activated', 'voided', 'skipped_active')
  ),
  CONSTRAINT student_card_batch_items_batch_student_key UNIQUE (batch_id, student_id),
  CONSTRAINT student_card_batch_items_student_tenant_fk
    FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id),
  CONSTRAINT student_card_batch_items_card_tenant_fk
    FOREIGN KEY (school_id, student_id, card_id)
    REFERENCES student_access_cards (school_id, student_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS student_card_batches_one_open_per_class
  ON student_card_batches (school_id, class_id)
  WHERE status IN ('prepared', 'received', 'saved');

CREATE INDEX IF NOT EXISTS idx_student_card_batches_school_open
  ON student_card_batches (school_id, expires_at)
  WHERE status IN ('prepared', 'received', 'saved');
