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
