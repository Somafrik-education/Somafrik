-- Finance P0 — reçu unique (payments) + lignes de libellés (payment_items).
-- Inventaire 1:1 uniquement. JAMAIS de fusion automatique par (élève, date).

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

-- Backfill déterministe 1 reçu historique = 1 ligne. Pas de GROUP BY élève/date.
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
