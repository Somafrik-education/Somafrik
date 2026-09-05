-- P1 #503 — search_path explicite sur les fonctions applicatives du schéma public.
-- Idempotente. Faible risque : ne change pas le corps des fonctions, seulement proconfig.
--
-- INTERDIT : ALTER EXTENSION btree_gist.
-- INTERDIT : déplacer btree_gist hors de son schéma d'extension.
-- Ne touche pas les fonctions appartenant à une extension (pg_depend deptype = 'e'),
-- ni les préfixes gist_/gbt_ (opérateur btree_gist le cas échéant).
-- INTERDIT : exécuter sur Somafrik-prod depuis Cursor. GO CTO obligatoire.

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND p.proname NOT LIKE 'gist_%'
      AND p.proname NOT LIKE 'gbt_%'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp',
      r.oid::regprocedure
    );
  END LOOP;
END
$$;

COMMIT;
