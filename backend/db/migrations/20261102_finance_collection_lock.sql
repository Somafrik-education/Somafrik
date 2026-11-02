-- FIN-SEC-01 — verrouillage des encaissements sur obligations ouvertes.
-- Additive. Ne réécrit aucune ligne historique.
-- La copie exécutée au démarrage est backend/db/financeSchema.js.
-- Le contrôle ne s'applique qu'aux transactions qui posent
-- somafrik.enforce_collection_cover = on (encaissement canonique).

CREATE OR REPLACE FUNCTION payments_assert_collection_covered()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  enforce TEXT;
  allocated NUMERIC(12,2);
  status TEXT;
BEGIN
  enforce := current_setting('somafrik.enforce_collection_cover', true);
  IF enforce IS DISTINCT FROM 'on' THEN
    RETURN NULL;
  END IF;

  status := lower(btrim(COALESCE(NEW.payment_status, '')));
  IF NEW.cancelled_at IS NOT NULL OR status IN ('cancelled', 'annule', 'pending') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0)
    INTO allocated
    FROM payment_allocations pa
   WHERE pa.payment_id = NEW.id
     AND pa.reversed_at IS NULL;

  IF allocated + 0.005 < COALESCE(NEW.amount, 0) OR allocated > COALESCE(NEW.amount, 0) + 0.005 THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_NOT_COVERED'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_collection_covered ON payments;
CREATE CONSTRAINT TRIGGER trg_payments_collection_covered
  AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION payments_assert_collection_covered();
