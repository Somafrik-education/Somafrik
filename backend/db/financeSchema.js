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
CREATE INDEX IF NOT EXISTS idx_payment_allocations_active_payment
  ON payment_allocations (payment_id)
  WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_allocations_active_obligation
  ON payment_allocations (obligation_id)
  WHERE reversed_at IS NULL;

-- F4 : une imputation est toujours validée au dernier point d'autorité PostgreSQL.
CREATE OR REPLACE FUNCTION payment_allocations_assert_canonical()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payment_school UUID;
  payment_student UUID;
  payment_amount NUMERIC(12,2);
  payment_currency TEXT;
  payment_cancelled_at TIMESTAMPTZ;
  obligation_school UUID;
  obligation_student UUID;
  obligation_due NUMERIC(12,2);
  obligation_exemption NUMERIC(12,2);
  obligation_currency TEXT;
  obligation_archived_at TIMESTAMPTZ;
  already_payment_allocated NUMERIC(12,2);
  already_obligation_allocated NUMERIC(12,2);
BEGIN
  SELECT p.school_id, p.student_id, p.amount, p.currency, p.cancelled_at
    INTO payment_school, payment_student, payment_amount, payment_currency, payment_cancelled_at
    FROM payments p
   WHERE p.id = NEW.payment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT o.school_id, o.student_id, o.amount_due, COALESCE(o.exemption, 0), o.currency, o.archived_at
    INTO obligation_school, obligation_student, obligation_due, obligation_exemption, obligation_currency, obligation_archived_at
    FROM student_fee_obligations o
   WHERE o.id = NEW.obligation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCE_OBLIGATION_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.school_id IS DISTINCT FROM payment_school OR NEW.school_id IS DISTINCT FROM obligation_school THEN
    RAISE EXCEPTION 'FINANCE_ALLOCATION_TENANT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF payment_student IS DISTINCT FROM obligation_student THEN
    RAISE EXCEPTION 'FINANCE_ALLOCATION_STUDENT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF (CASE WHEN upper(btrim(COALESCE(payment_currency, ''))) = 'FC' THEN 'CDF' ELSE upper(btrim(COALESCE(payment_currency, ''))) END)
     IS DISTINCT FROM
     (CASE WHEN upper(btrim(COALESCE(obligation_currency, ''))) = 'FC' THEN 'CDF' ELSE upper(btrim(COALESCE(obligation_currency, ''))) END) THEN
    RAISE EXCEPTION 'FINANCE_CURRENCY_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.reversed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF payment_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_CANCELLED' USING ERRCODE = 'check_violation';
  END IF;
  IF obligation_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_OBLIGATION_NOT_OPEN' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0)
    INTO already_payment_allocated
    FROM payment_allocations pa
   WHERE pa.payment_id = NEW.payment_id AND pa.reversed_at IS NULL AND pa.id IS DISTINCT FROM NEW.id;
  IF already_payment_allocated + NEW.amount > payment_amount + 0.005 THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_OVERALLOCATED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0)
    INTO already_obligation_allocated
    FROM payment_allocations pa
   WHERE pa.obligation_id = NEW.obligation_id AND pa.reversed_at IS NULL AND pa.id IS DISTINCT FROM NEW.id;
  IF already_obligation_allocated + NEW.amount > GREATEST(0, obligation_due - obligation_exemption) + 0.005 THEN
    RAISE EXCEPTION 'FINANCE_OBLIGATION_OVERALLOCATED' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_allocations_canonical_guard ON payment_allocations;
CREATE TRIGGER trg_payment_allocations_canonical_guard
  BEFORE INSERT OR UPDATE OF school_id, payment_id, obligation_id, amount, reversed_at
  ON payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION payment_allocations_assert_canonical();

-- F4 : amount_paid/balance/status ne sont plus une autorité indépendante.
CREATE OR REPLACE FUNCTION student_fee_obligations_project_allocations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocated NUMERIC(12,2);
  computed_balance NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(pa.amount), 0)
    INTO allocated
    FROM payment_allocations pa
   WHERE pa.obligation_id = NEW.id AND pa.reversed_at IS NULL;

  NEW.amount_paid := allocated;
  computed_balance := GREATEST(0, COALESCE(NEW.amount_due, 0) - allocated - COALESCE(NEW.exemption, 0));
  NEW.balance := computed_balance;

  IF NEW.archived_at IS NOT NULL THEN
    NEW.status := 'Annulé';
  ELSIF COALESCE(NEW.exemption, 0) >= COALESCE(NEW.amount_due, 0) AND COALESCE(NEW.amount_due, 0) > 0 THEN
    NEW.status := 'Exonéré';
  ELSIF computed_balance <= 0 THEN
    NEW.status := 'Payé';
  ELSIF allocated > 0 THEN
    NEW.status := 'Partiellement payé';
  ELSIF NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'En retard';
  ELSE
    NEW.status := 'À payer';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_fee_obligations_project_allocations ON student_fee_obligations;
CREATE TRIGGER trg_student_fee_obligations_project_allocations
  BEFORE INSERT OR UPDATE ON student_fee_obligations
  FOR EACH ROW
  EXECUTE FUNCTION student_fee_obligations_project_allocations();

CREATE OR REPLACE FUNCTION payment_allocations_refresh_obligation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_obligation UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_obligation := NEW.obligation_id;
  ELSE
    target_obligation := COALESCE(NEW.obligation_id, OLD.obligation_id);
  END IF;
  UPDATE student_fee_obligations SET updated_at = NOW() WHERE id = target_obligation;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_allocations_refresh_obligation ON payment_allocations;
CREATE TRIGGER trg_payment_allocations_refresh_obligation
  AFTER INSERT OR UPDATE OF amount, reversed_at ON payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION payment_allocations_refresh_obligation();

CREATE UNIQUE INDEX IF NOT EXISTS student_fee_obligations_active_uniq
  ON student_fee_obligations (
    school_id,
    student_id,
    (COALESCE(fee_grid_id, '')),
    (COALESCE(school_fee_item_id, '')),
    (COALESCE(period_label, ''))
  )
  WHERE archived_at IS NULL;

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS class_effective_date DATE;
UPDATE enrollments
   SET class_effective_date = enrollment_date
 WHERE class_effective_date IS NULL
   AND enrollment_date IS NOT NULL;

ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS fee_type_code TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS period_key TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS source_enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL;
-- Lignée UUID best-effort : replaceGridItems DELETE les items, d'où ON DELETE SET NULL.
-- Snapshot de lignée stable = school_fee_item_id (code item), pas cet UUID.
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS source_fee_item_uuid UUID REFERENCES school_fee_items(id) ON DELETE SET NULL;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE student_fee_obligations ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS student_fee_obligations_identity_uniq
  ON student_fee_obligations (
    school_id,
    student_id,
    (COALESCE(academic_year, '')),
    (COALESCE(fee_type_code, '')),
    (COALESCE(period_key, ''))
  )
  WHERE archived_at IS NULL
    AND period_key IS NOT NULL AND btrim(period_key) <> ''
    AND fee_type_code IS NOT NULL AND btrim(fee_type_code) <> '';

-- P1 F3 : une écriture d'obligation class-scoped doit se sérialiser avec tout
-- transfert de classe concurrent. Cette garde PostgreSQL est le dernier point
-- d'autorité : elle verrouille l'inscription active juste avant l'INSERT.
CREATE OR REPLACE FUNCTION student_fee_obligations_assert_active_enrollment_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  enrollment_class UUID;
BEGIN
  IF NEW.archived_at IS NOT NULL
     OR NEW.class_id IS NULL
     OR COALESCE(btrim(NEW.academic_year), '') = '' THEN
    RETURN NEW;
  END IF;

  SELECT e.class_id
    INTO enrollment_class
    FROM enrollments e
    JOIN academic_years ay ON ay.id = e.academic_year_id
   WHERE e.student_id = NEW.student_id
     AND e.school_id = NEW.school_id
     AND lower(btrim(e.status)) = 'active'
     AND lower(btrim(ay.name)) = lower(btrim(NEW.academic_year))
   ORDER BY e.enrollment_date DESC NULLS LAST, e.created_at DESC NULLS LAST
   LIMIT 1
   FOR UPDATE OF e;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCE_ENROLLMENT_NOT_FOUND'
      USING ERRCODE = '23505',
            CONSTRAINT = 'student_fee_obligations_active_enrollment_guard';
  END IF;

  IF enrollment_class IS DISTINCT FROM NEW.class_id THEN
    RAISE EXCEPTION 'FINANCE_CLASS_ENROLLMENT_MISMATCH'
      USING ERRCODE = '23505',
            CONSTRAINT = 'student_fee_obligations_active_enrollment_guard';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_fee_obligations_active_enrollment_scope ON student_fee_obligations;
CREATE TRIGGER trg_student_fee_obligations_active_enrollment_scope
  BEFORE INSERT OR UPDATE OF school_id, student_id, class_id, academic_year, archived_at
  ON student_fee_obligations
  FOR EACH ROW
  EXECUTE FUNCTION student_fee_obligations_assert_active_enrollment_scope();

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