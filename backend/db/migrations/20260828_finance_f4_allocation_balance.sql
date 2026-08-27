-- Finance F4 — allocations et soldes canoniques.
-- payment_allocations est l'autorité de l'imputation ; student_fee_obligations.amount_paid/balance/status
-- deviennent une projection matérialisée maintenue par PostgreSQL.

CREATE INDEX IF NOT EXISTS idx_payment_allocations_active_payment
  ON payment_allocations (payment_id)
  WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_allocations_active_obligation
  ON payment_allocations (obligation_id)
  WHERE reversed_at IS NULL;

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
    RAISE EXCEPTION 'FINANCE_PAYMENT_NOT_FOUND'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT o.school_id, o.student_id, o.amount_due, COALESCE(o.exemption, 0), o.currency, o.archived_at
    INTO obligation_school, obligation_student, obligation_due, obligation_exemption, obligation_currency, obligation_archived_at
    FROM student_fee_obligations o
   WHERE o.id = NEW.obligation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCE_OBLIGATION_NOT_FOUND'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.school_id IS DISTINCT FROM payment_school
     OR NEW.school_id IS DISTINCT FROM obligation_school THEN
    RAISE EXCEPTION 'FINANCE_ALLOCATION_TENANT_MISMATCH'
      USING ERRCODE = 'check_violation';
  END IF;

  IF payment_student IS DISTINCT FROM obligation_student THEN
    RAISE EXCEPTION 'FINANCE_ALLOCATION_STUDENT_MISMATCH'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (CASE WHEN upper(btrim(COALESCE(payment_currency, ''))) = 'FC' THEN 'CDF' ELSE upper(btrim(COALESCE(payment_currency, ''))) END)
     IS DISTINCT FROM
     (CASE WHEN upper(btrim(COALESCE(obligation_currency, ''))) = 'FC' THEN 'CDF' ELSE upper(btrim(COALESCE(obligation_currency, ''))) END) THEN
    RAISE EXCEPTION 'FINANCE_CURRENCY_MISMATCH'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Une inversion reste autorisée : les contrôles de capacité ne concernent que les allocations actives.
  IF NEW.reversed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF payment_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_CANCELLED'
      USING ERRCODE = 'check_violation';
  END IF;

  IF obligation_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_OBLIGATION_NOT_OPEN'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0)
    INTO already_payment_allocated
    FROM payment_allocations pa
   WHERE pa.payment_id = NEW.payment_id
     AND pa.reversed_at IS NULL
     AND pa.id IS DISTINCT FROM NEW.id;

  IF already_payment_allocated + NEW.amount > payment_amount + 0.005 THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_OVERALLOCATED'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0)
    INTO already_obligation_allocated
    FROM payment_allocations pa
   WHERE pa.obligation_id = NEW.obligation_id
     AND pa.reversed_at IS NULL
     AND pa.id IS DISTINCT FROM NEW.id;

  IF already_obligation_allocated + NEW.amount > GREATEST(0, obligation_due - obligation_exemption) + 0.005 THEN
    RAISE EXCEPTION 'FINANCE_OBLIGATION_OVERALLOCATED'
      USING ERRCODE = 'check_violation';
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
   WHERE pa.obligation_id = NEW.id
     AND pa.reversed_at IS NULL;

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
  BEFORE INSERT OR UPDATE
  ON student_fee_obligations
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

  UPDATE student_fee_obligations
     SET updated_at = NOW()
   WHERE id = target_obligation;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_allocations_refresh_obligation ON payment_allocations;
CREATE TRIGGER trg_payment_allocations_refresh_obligation
  AFTER INSERT OR UPDATE OF amount, reversed_at
  ON payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION payment_allocations_refresh_obligation();

-- Backfill non destructif : toute obligation existante est recalculée depuis les allocations actives.
UPDATE student_fee_obligations
   SET updated_at = NOW();