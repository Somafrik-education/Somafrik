-- BULLETIN-CLASSE-01 / L3 — privilèges Supabase sur les logos figés.
-- Migration manuelle idempotente. Appliquée en préproduction le 2026-11-05.
-- Supabase accorde initialement à service_role les privilèges TRUNCATE,
-- UPDATE et DELETE, alors que le trigger d'immuabilité ne couvre pas TRUNCATE.
-- Garder les droits à la connexion PostgreSQL de l'API, sans ouvrir les
-- octets des logos aux rôles exposés par la Data API.
-- À exécuter après 20261106_report_card_official_assets.sql, jamais au démarrage.
REVOKE ALL PRIVILEGES ON TABLE public.report_card_official_assets FROM service_role;
REVOKE ALL PRIVILEGES ON TABLE public.report_card_official_assets FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.report_card_official_assets FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.report_card_official_assets FROM PUBLIC;
