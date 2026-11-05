-- BULLETIN-CLASSE-01 / L3 — copies officielles immuables des logos d'établissement.
--
-- JAMAIS exécutée automatiquement. Application manuelle (même procédure que L1) :
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--        [-c "SELECT set_config('somafrik.app_role', '<rôle de DATABASE_URL de l''API>', true)"] \
--        -f backend/db/migrations/20261106_report_card_official_assets.sql
--
-- Un bulletin publié avec un en-tête configurable fige l'identité de l'établissement dans son
-- contenu signé (official_identity : nom, adresse, pays, empreinte du logo). Le logo étant
-- remplaçable (et l'ancien fichier supprimé), ses octets sont copiés ici, adressés par empreinte
-- SHA-256 : la réimpression reproduit toujours le logo d'origine.
--   - additive et idempotente ; aucune table existante modifiée ;
--   - lignes immuables (trigger : ni UPDATE ni DELETE) ;
--   - accès : rôle applicatif uniquement (SELECT, INSERT) ; anon / authenticated / PUBLIC : aucun.
-- Rollback : 20261106_report_card_official_assets.rollback.sql (refusé dès qu'un logo est figé).

SELECT set_config('lock_timeout', '5s', true);

CREATE TABLE IF NOT EXISTS report_card_official_assets (
  school_id UUID NOT NULL REFERENCES schools(id),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, sha256),
  CONSTRAINT report_card_official_assets_size CHECK (octet_length(bytes) = byte_size)
);

CREATE OR REPLACE FUNCTION report_card_official_assets_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'OFFICIAL_ASSET_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_report_card_official_assets_protect ON report_card_official_assets;
CREATE TRIGGER trg_report_card_official_assets_protect
BEFORE UPDATE OR DELETE ON report_card_official_assets
FOR EACH ROW EXECUTE FUNCTION report_card_official_assets_protect();

REVOKE ALL PRIVILEGES ON TABLE report_card_official_assets FROM PUBLIC;

DO $official_assets$
DECLARE
  role_name text;
  app_role text := coalesce(nullif(btrim(current_setting('somafrik.app_role', true)), ''), current_user);
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE report_card_official_assets FROM %I', role_name);
    END IF;
  END LOOP;
  IF lower(app_role) IN ('anon', 'authenticated', 'public') THEN
    RAISE EXCEPTION 'somafrik.app_role refusé : %', app_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'somafrik.app_role inconnu : %', app_role;
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON TABLE report_card_official_assets TO %I', app_role);
  ALTER TABLE report_card_official_assets ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS report_card_official_assets_app_select ON report_card_official_assets;
  DROP POLICY IF EXISTS report_card_official_assets_app_insert ON report_card_official_assets;
  EXECUTE format('CREATE POLICY report_card_official_assets_app_select ON report_card_official_assets FOR SELECT TO %I USING (true)', app_role);
  EXECUTE format('CREATE POLICY report_card_official_assets_app_insert ON report_card_official_assets FOR INSERT TO %I WITH CHECK (true)', app_role);
END
$official_assets$;
