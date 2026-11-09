-- CARTE-PR1 — socle PostgreSQL student_access_cards (idempotent).
-- Médiateur d'identification révocable. Pas de secret plaintext. Pas de copie métier élève.

CREATE UNIQUE INDEX IF NOT EXISTS students_school_id_id_uidx
  ON students (school_id, id);

CREATE TABLE IF NOT EXISTS student_access_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL,
  public_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  medium TEXT NOT NULL,
  status TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  replaced_by_card_id UUID,
  created_by_user_id UUID REFERENCES users(id),
  last_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_access_cards_public_id_key UNIQUE (public_id),
  CONSTRAINT student_access_cards_token_hash_key UNIQUE (token_hash),
  CONSTRAINT student_access_cards_token_hash_sha256_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT student_access_cards_medium_check
    CHECK (medium IN ('nfc', 'qr', 'nfc_qr')),
  CONSTRAINT student_access_cards_status_check
    CHECK (status IN ('issued', 'active', 'lost', 'revoked', 'replaced')),
  CONSTRAINT student_access_cards_lifecycle_check CHECK (
    (status IN ('issued', 'active') AND revoked_at IS NULL AND replaced_by_card_id IS NULL)
    OR (status IN ('lost', 'revoked') AND revoked_at IS NOT NULL AND replaced_by_card_id IS NULL)
    OR (status = 'replaced' AND revoked_at IS NOT NULL AND replaced_by_card_id IS NOT NULL)
  ),
  CONSTRAINT student_access_cards_replaced_not_self_check
    CHECK (replaced_by_card_id IS NULL OR replaced_by_card_id <> id),
  CONSTRAINT student_access_cards_school_student_id_key UNIQUE (school_id, student_id, id),
  CONSTRAINT student_access_cards_student_tenant_fk
    FOREIGN KEY (school_id, student_id)
    REFERENCES students (school_id, id),
  CONSTRAINT student_access_cards_replaced_by_same_student_fk
    FOREIGN KEY (school_id, student_id, replaced_by_card_id)
    REFERENCES student_access_cards (school_id, student_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS student_access_cards_one_active_per_student
  ON student_access_cards (school_id, student_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_student_access_cards_school_student
  ON student_access_cards (school_id, student_id, created_at DESC);

DO $student_access_cards_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'student_access_cards_student_tenant_fk'
  ) THEN
    ALTER TABLE student_access_cards
      ADD CONSTRAINT student_access_cards_student_tenant_fk
      FOREIGN KEY (school_id, student_id)
      REFERENCES students (school_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'student_access_cards_replaced_by_same_student_fk'
  ) THEN
    ALTER TABLE student_access_cards
      ADD CONSTRAINT student_access_cards_replaced_by_same_student_fk
      FOREIGN KEY (school_id, student_id, replaced_by_card_id)
      REFERENCES student_access_cards (school_id, student_id, id);
  END IF;
END
$student_access_cards_constraints$;
