"use strict";

/**
 * LOT 4 — structures Finance manquantes. Idempotent (IF NOT EXISTS).
 * Aucun COPY / INSERT depuis backoffice_state JSON.
 */

const FINANCE_SCHEMA_SQL = `
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_type TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);

ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payment_reminders ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS payment_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  status_code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_statuses_school_code_uniq
  ON payment_statuses ((COALESCE(school_id, '00000000-0000-0000-0000-000000000000'::uuid)), status_code);

CREATE TABLE IF NOT EXISTS fee_grids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  grid_code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  period_name TEXT NOT NULL DEFAULT '',
  currency VARCHAR(16) NOT NULL DEFAULT 'CDF',
  status TEXT NOT NULL DEFAULT 'Brouillon',
  class_id UUID REFERENCES classes(id),
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, grid_code)
);

ALTER TABLE fee_grids ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id);

CREATE UNIQUE INDEX IF NOT EXISTS fee_grids_school_class_year_period_uniq
  ON fee_grids (
    school_id,
    (lower(btrim(class_name))),
    (lower(btrim(academic_year))),
    (lower(btrim(period_name)))
  );

CREATE UNIQUE INDEX IF NOT EXISTS school_fee_items_grid_code_uniq ON school_fee_items (fee_grid_id, item_code);

CREATE TABLE IF NOT EXISTS school_fee_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  fee_grid_id UUID NOT NULL REFERENCES fee_grids(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  fee_type TEXT NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date DATE,
  period_label TEXT,
  monthly_months JSONB NOT NULL DEFAULT '[]'::jsonb,
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'Actif',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fee_grid_id, item_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_fee_items_grid_code_uniq ON school_fee_items (fee_grid_id, item_code);

CREATE TABLE IF NOT EXISTS fee_tariff_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  fee_grid_id UUID REFERENCES fee_grids(id),
  action TEXT NOT NULL,
  actor_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  obligation_id UUID NOT NULL REFERENCES student_fee_obligations(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_obligation ON payment_allocations (obligation_id);

CREATE UNIQUE INDEX IF NOT EXISTS student_fee_obligations_active_uniq
  ON student_fee_obligations (
    school_id,
    student_id,
    (COALESCE(fee_grid_id, '')),
    (COALESCE(school_fee_item_id, '')),
    (COALESCE(period_label, ''))
  )
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  school_fee_item_id UUID REFERENCES school_fee_items(id),
  fee_type TEXT NOT NULL,
  fee_label TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_items_payment ON payment_items (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_school ON payment_items (school_id);

CREATE TABLE IF NOT EXISTS school_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  method_code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, method_code)
);

CREATE OR REPLACE FUNCTION payment_items_assert_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payment_school UUID;
  catalog_school UUID;
BEGIN
  SELECT school_id INTO payment_school FROM payments WHERE id = NEW.payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_id introuvable'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF payment_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'PAYMENT_ITEM_TENANT_MISMATCH'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.school_fee_item_id IS NOT NULL THEN
    SELECT school_id INTO catalog_school FROM school_fee_items WHERE id = NEW.school_fee_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FEE_ITEM_NOT_FOUND'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF catalog_school IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'FEE_ITEM_TENANT_MISMATCH'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_items_tenant ON payment_items;
CREATE TRIGGER trg_payment_items_tenant
  BEFORE INSERT OR UPDATE OF school_id, payment_id, school_fee_item_id
  ON payment_items
  FOR EACH ROW
  EXECUTE FUNCTION payment_items_assert_tenant();

INSERT INTO payment_items (school_id, payment_id, fee_type, fee_label, amount, sort_order)
SELECT
  p.school_id,
  p.id,
  COALESCE(NULLIF(btrim(p.fee_type), ''), 'Autre frais'),
  COALESCE(NULLIF(btrim(p.fee_type), ''), 'Autre frais'),
  p.amount,
  0
FROM payments p
WHERE p.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM payment_items i WHERE i.payment_id = p.id
  );
`;

module.exports = { FINANCE_SCHEMA_SQL };
