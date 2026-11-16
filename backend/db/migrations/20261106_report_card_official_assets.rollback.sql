-- BULLETIN-CLASSE-01 / L3 — retour arrière de 20261106_report_card_official_assets.sql.
-- JAMAIS automatique. REFUSÉ dès qu'un logo officiel est figé : des bulletins publiés en
-- dépendent (réimpression fidèle), aucune copie officielle n'est jamais supprimée.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--        -f backend/db/migrations/20261106_report_card_official_assets.rollback.sql

DO $official_assets_rollback$
BEGIN
  IF to_regclass('public.report_card_official_assets') IS NOT NULL
     AND EXISTS (SELECT 1 FROM report_card_official_assets) THEN
    RAISE EXCEPTION 'OFFICIAL_ASSETS_ROLLBACK_REFUSED : des logos officiels figés existent';
  END IF;
END
$official_assets_rollback$;

DROP TABLE IF EXISTS report_card_official_assets;
DROP FUNCTION IF EXISTS report_card_official_assets_protect();
