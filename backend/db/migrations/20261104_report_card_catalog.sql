-- BULLETIN-CATALOG-01 — catalogue des modèles de bulletins et disponibilité par pays.
--
-- HOLD (décision CTO) : fichier de travail, JAMAIS exécuté automatiquement.
-- Aucun appel au démarrage (postgresRepository) tant que le catalogue n'est pas validé.
--
-- Additive et idempotente : trois tables nouvelles, aucune modification des
-- tables existantes (profils, gabarits, demandes, liaisons, snapshots publiés).
-- Indépendante du moteur somafrik.report_card.v1 : aucun calcul ne lit ces tables.
--
-- - report_card_catalog_models : identité stable et version des modèles génériques.
-- - report_card_catalog_availability : disponibilité d'un modèle dans un pays
--   (countries.id, source canonique). Aucune ligne = NON disponible (fail-closed).
-- - report_card_catalog_availability_audit : historique (ancienne / nouvelle valeur,
--   auteur, date). Jamais modifié ni supprimé par l'application.
--
-- Désactiver un modèle dans un pays empêche seulement les NOUVELLES configurations :
-- les configurations déjà actives et les bulletins publiés ne sont pas touchés.
-- Retour arrière : voir 20261104_report_card_catalog.rollback.sql.

CREATE TABLE IF NOT EXISTS report_card_catalog_models (
  model_id TEXT PRIMARY KEY CHECK (model_id ~ '^[a-z][a-z0-9-]{0,39}$'),
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  description TEXT NOT NULL,
  presentation_style TEXT NOT NULL CHECK (presentation_style IN ('simple', 'hierarchical')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Modèles initiaux, construits à partir des caractéristiques structurelles des
-- deux références pédagogiques (La Colombière : matières simples ; Le Berceau de
-- la Sagesse : matières principales et sous-matières). Modèles personnalisables
-- par chaque établissement ; aucun établissement imposé.
INSERT INTO report_card_catalog_models (model_id, version, name, description, presentation_style)
VALUES
  ('colombiere', 1, 'Modèle Colombière — matières simples',
   'Une ligne par matière ; évaluation configurable (travail journalier et examen, ou note unique par période) ; maxima par matière ; trois trimestres et bilan annuel ; pourcentage et rang.',
   'simple'),
  ('berceau', 1, 'Modèle Berceau — matières et sous-matières',
   'Matières principales regroupant des sous-matières ; évaluation configurable ; maxima par sous-matière ; sous-totaux par matière principale ; trois trimestres et bilan annuel.',
   'hierarchical')
ON CONFLICT (model_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS report_card_catalog_availability (
  model_id TEXT NOT NULL REFERENCES report_card_catalog_models (model_id) ON DELETE RESTRICT,
  country_id UUID NOT NULL REFERENCES countries (id) ON DELETE RESTRICT,
  available BOOLEAN NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (model_id, country_id)
);

CREATE TABLE IF NOT EXISTS report_card_catalog_availability_audit (
  id BIGSERIAL PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES report_card_catalog_models (model_id) ON DELETE RESTRICT,
  country_id UUID NOT NULL REFERENCES countries (id) ON DELETE RESTRICT,
  old_available BOOLEAN,
  new_available BOOLEAN NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_card_catalog_audit_model
  ON report_card_catalog_availability_audit (model_id, created_at DESC);


-- BULLETIN-PREPROD-02 — durcissement Supabase.
-- Les privilèges par défaut des tables public peuvent autoriser anon/authenticated.
-- Les routes HTTP du backend utilisent la connexion PostgreSQL serveur ; aucun
-- accès direct au Data API Supabase n'est nécessaire pour ces trois tables.
-- Révoquer explicitement les privilèges publics et activer RLS (politiques : rôle applicatif seulement, ci-dessous).
-- Cette opération est additive et idempotente, également sur une base non-Supabase.
REVOKE ALL PRIVILEGES ON TABLE public.report_card_catalog_models FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.report_card_catalog_availability FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.report_card_catalog_availability_audit FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SEQUENCE public.report_card_catalog_availability_audit_id_seq FROM PUBLIC;

-- Les rôles Supabase existent sur le projet réel ; via DO, la migration reste
-- compatible avec PostgreSQL local où ces rôles ne sont pas définis.
DO $catalog_security$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.report_card_catalog_models FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.report_card_catalog_availability FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.report_card_catalog_availability_audit FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.report_card_catalog_availability_audit_id_seq FROM %I', role_name);
    END IF;
  END LOOP;
END
$catalog_security$;

ALTER TABLE public.report_card_catalog_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_card_catalog_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_card_catalog_availability_audit ENABLE ROW LEVEL SECURITY;

-- BULLETIN-PREPROD-02 (correctif CTO) — accès du rôle applicatif réel sous RLS.
-- RLS sans politique bloque tout rôle non propriétaire et non BYPASSRLS : catalogue
-- vide, disponibilité et audit refusés. Le rôle de l'API reçoit donc EXPLICITEMENT
-- les seuls privilèges utilisés par reportCardCatalogPgStore, et des politiques
-- limitées à ce rôle. Jamais de BYPASSRLS. Jamais anon / authenticated / PUBLIC.
--   Rôle applicatif : réglage de transaction somafrik.catalog_app_role si présent,
--   sinon le rôle qui applique la migration (recommandé : connexion de l'API).
--   - modèles : SELECT ;
--   - disponibilité : SELECT, INSERT, UPDATE (upsert et SELECT … FOR UPDATE) ;
--   - historique : SELECT, INSERT (jamais UPDATE ni DELETE : journal en ajout seul) ;
--   - séquence de l'historique : USAGE, SELECT.
-- Ré-exécutable : politiques recréées à l'identique ; changer de rôle applicatif =
-- ré-exécuter avec le nouveau rôle (les anciennes politiques sont remplacées).
DO $catalog_app_access$
DECLARE
  app_role text := coalesce(nullif(btrim(current_setting('somafrik.catalog_app_role', true)), ''), current_user);
BEGIN
  IF lower(app_role) IN ('anon', 'authenticated', 'public') THEN
    RAISE EXCEPTION 'somafrik.catalog_app_role refusé : % (rôle d''accès public)', app_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'somafrik.catalog_app_role inconnu : %', app_role;
  END IF;

  EXECUTE format('GRANT SELECT ON TABLE public.report_card_catalog_models TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.report_card_catalog_availability TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE public.report_card_catalog_availability_audit TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.report_card_catalog_availability_audit_id_seq TO %I', app_role);

  DROP POLICY IF EXISTS report_card_catalog_models_app_select ON public.report_card_catalog_models;
  DROP POLICY IF EXISTS report_card_catalog_availability_app_select ON public.report_card_catalog_availability;
  DROP POLICY IF EXISTS report_card_catalog_availability_app_insert ON public.report_card_catalog_availability;
  DROP POLICY IF EXISTS report_card_catalog_availability_app_update ON public.report_card_catalog_availability;
  DROP POLICY IF EXISTS report_card_catalog_audit_app_select ON public.report_card_catalog_availability_audit;
  DROP POLICY IF EXISTS report_card_catalog_audit_app_insert ON public.report_card_catalog_availability_audit;

  EXECUTE format('CREATE POLICY report_card_catalog_models_app_select ON public.report_card_catalog_models FOR SELECT TO %I USING (true)', app_role);
  EXECUTE format('CREATE POLICY report_card_catalog_availability_app_select ON public.report_card_catalog_availability FOR SELECT TO %I USING (true)', app_role);
  EXECUTE format('CREATE POLICY report_card_catalog_availability_app_insert ON public.report_card_catalog_availability FOR INSERT TO %I WITH CHECK (true)', app_role);
  EXECUTE format('CREATE POLICY report_card_catalog_availability_app_update ON public.report_card_catalog_availability FOR UPDATE TO %I USING (true) WITH CHECK (true)', app_role);
  EXECUTE format('CREATE POLICY report_card_catalog_audit_app_select ON public.report_card_catalog_availability_audit FOR SELECT TO %I USING (true)', app_role);
  EXECUTE format('CREATE POLICY report_card_catalog_audit_app_insert ON public.report_card_catalog_availability_audit FOR INSERT TO %I WITH CHECK (true)', app_role);
END
$catalog_app_access$;
