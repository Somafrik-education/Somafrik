-- BULLETIN-CLASSE-01 / L3 — restriction des privilèges hérités Supabase.
-- Migration manuelle idempotente, préproduction appliquée le 2026-11-05.
-- Le rôle service_role reçoit des droits par défaut dans Supabase. Le trigger
-- anti-UPDATE/DELETE ne protège pas TRUNCATE : aucune permission de table
-- ne doit être laissée à service_role, anon ou authenticated.
-- Le rôle PostgreSQL de l'API possède son accès distinct (migration L3).
-- Ne pas lancer au démarrage de l'application.
DO $restrict_assets$
BEGIN
  IF to_regclass('public.report_card_official_assets') IS NULL THEN
    RAISE EXCEPTION 'OFFICIAL_ASSETS_UNAVAILABLE';
  END IF;
  REVOKE ALL PRIVILEGES ON TABLE public.report_card_official_assets FROM service_role, anon, authenticated, PUBLIC;
END
$restrict_assets$;
