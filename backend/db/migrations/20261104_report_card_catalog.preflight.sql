-- BULLETIN-PREPROD-01 — préflight NON DESTRUCTIF de 20261104_report_card_catalog.sql.
--
-- Lecture seule : transaction READ ONLY terminée par ROLLBACK. Aucune écriture,
-- aucun verrou exclusif, aucun DDL. À exécuter AVANT toute décision d'application.
--
--   psql "$PREPROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--        -v expected_db='<nom exact de la base de préproduction>' \
--        -f backend/db/migrations/20261104_report_card_catalog.preflight.sql
--
-- Lecture du résultat : une ligne par contrôle (check, status, detail).
--   GO     : conforme ;  WARN : à examiner, non bloquant ;  NO-GO : bloquant.
-- Dernière ligne « VERDICT » : NO-GO si au moins un contrôle NO-GO.

\set QUIET on
\pset pager off
\pset null '∅'
\set QUIET off

\if :{?expected_db}
\else
  \echo 'NO-GO : variable expected_db absente (ajouter -v expected_db=<nom de la base de préproduction>).'
  \quit
\endif

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

-- Tables lues par les contrôles : leur absence est un NO-GO explicite, pas une erreur SQL.
SELECT to_regclass('public.countries') IS NOT NULL
       AND to_regclass('public.schools') IS NOT NULL
       AND to_regclass('public.report_card_configuration_requests') IS NOT NULL AS has_core,
       to_regclass('public.report_card_catalog_models') IS NOT NULL AS has_catalog
\gset

\if :has_core

WITH
expected_tables(name) AS (
  VALUES ('report_card_catalog_models'), ('report_card_catalog_availability'), ('report_card_catalog_availability_audit')
),
catalog_tables AS (
  SELECT name, to_regclass('public.' || name) AS ref FROM expected_tables
),
catalog_present AS (
  SELECT count(*) FILTER (WHERE ref IS NOT NULL) AS present, count(*) AS total FROM catalog_tables
),
prerequisite_tables(name) AS (
  VALUES ('countries'), ('schools'), ('subjects'), ('terms'), ('academic_years'), ('evaluation_types'), ('users'),
         ('academic_rule_profiles'), ('academic_rule_profile_versions'),
         ('report_card_schemas'), ('report_card_schema_versions'),
         ('report_card_rendering_templates'), ('report_card_rendering_template_versions'),
         ('report_card_configuration_requests'), ('report_card_configuration_audit'),
         ('report_card_configuration_commands'), ('report_card_active_bindings'),
         ('report_card_published_snapshots')
),
missing_prerequisites AS (
  SELECT string_agg(name, ', ' ORDER BY name) AS names, count(*) AS n
    FROM prerequisite_tables WHERE to_regclass('public.' || name) IS NULL
),
countries_id AS (
  SELECT a.atttypid::regtype::text AS type_name,
         EXISTS (
           SELECT 1 FROM pg_index i
            WHERE i.indrelid = 'public.countries'::regclass AND (i.indisprimary OR i.indisunique)
              AND i.indnatts = 1 AND i.indkey[0] = a.attnum
         ) AS is_unique
    FROM pg_attribute a
   WHERE to_regclass('public.countries') IS NOT NULL
     AND a.attrelid = to_regclass('public.countries') AND a.attname = 'id' AND NOT a.attisdropped
),
foreign_objects AS (
  -- Objets portant le préfixe du catalogue mais NON créés par la migration : conflit.
  SELECT string_agg(c.relname || ' (' || c.relkind::text || ')', ', ' ORDER BY c.relname) AS names, count(*) AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname LIKE 'report\_card\_catalog%'
     AND c.relname NOT IN (
       'report_card_catalog_models', 'report_card_catalog_models_pkey',
       'report_card_catalog_availability', 'report_card_catalog_availability_pkey',
       'report_card_catalog_availability_audit', 'report_card_catalog_availability_audit_pkey',
       'report_card_catalog_availability_audit_id_seq', 'idx_report_card_catalog_audit_model'
     )
),
checks(ord, "check", status, detail) AS (
  SELECT 1, 'P01 base cible',
         CASE WHEN current_database() = :'expected_db' THEN 'GO' ELSE 'NO-GO' END,
         'connecté à « ' || current_database() || ' » (attendu « ' || :'expected_db' || ' »), utilisateur ' || current_user
         || ', serveur ' || coalesce(host(inet_server_addr()), 'socket local') || ':' || coalesce(inet_server_port()::text, '?')
  UNION ALL
  SELECT 2, 'P02 garde production',
         CASE WHEN current_database() ~* 'prod' AND current_database() !~* 'preprod|staging' THEN 'NO-GO' ELSE 'GO' END,
         'un nom de base de production refuse le préflight (ne rien modifier en production)'
  UNION ALL
  SELECT 3, 'P03 transaction lecture seule',
         CASE WHEN current_setting('transaction_read_only') = 'on' THEN 'GO' ELSE 'NO-GO' END,
         'transaction_read_only = ' || current_setting('transaction_read_only')
  UNION ALL
  SELECT 4, 'P04 version PostgreSQL',
         CASE WHEN current_setting('server_version_num')::int >= 120000 THEN 'GO' ELSE 'WARN' END,
         current_setting('server_version')
  UNION ALL
  SELECT 5, 'P05 schéma public',
         CASE WHEN to_regnamespace('public') IS NULL THEN 'NO-GO'
              WHEN has_schema_privilege(current_user, 'public', 'CREATE') THEN 'GO'
              ELSE 'NO-GO' END,
         'search_path = ' || current_setting('search_path')
         || ' ; droit CREATE sur public pour ' || current_user || ' : '
         || CASE WHEN to_regnamespace('public') IS NOT NULL AND has_schema_privilege(current_user, 'public', 'CREATE') THEN 'oui' ELSE 'non' END
  UNION ALL
  SELECT 6, 'P06 dépendance countries',
         CASE WHEN to_regclass('public.countries') IS NULL THEN 'NO-GO'
              WHEN (SELECT type_name FROM countries_id) IS DISTINCT FROM 'uuid' THEN 'NO-GO'
              WHEN NOT coalesce((SELECT is_unique FROM countries_id), false) THEN 'NO-GO'
              ELSE 'GO' END,
         CASE WHEN to_regclass('public.countries') IS NULL THEN 'table countries absente'
              ELSE 'countries.id : ' || coalesce((SELECT type_name FROM countries_id), 'absent')
                   || ', clé unique : ' || CASE WHEN coalesce((SELECT is_unique FROM countries_id), false) THEN 'oui' ELSE 'non' END END
  UNION ALL
  SELECT 7, 'P07 pays enregistrés',
         CASE WHEN to_regclass('public.countries') IS NULL THEN 'NO-GO'
              WHEN (SELECT count(*) FROM countries) = 0 THEN 'WARN' ELSE 'GO' END,
         CASE WHEN to_regclass('public.countries') IS NULL THEN '—'
              ELSE (SELECT count(*) FROM countries)::text || ' pays : '
                   || coalesce((SELECT string_agg(coalesce(iso_code, '?'), ', ' ORDER BY iso_code) FROM countries), '—') END
  UNION ALL
  SELECT 8, 'P08 établissements sans pays',
         CASE WHEN to_regclass('public.schools') IS NULL THEN 'NO-GO'
              WHEN (SELECT count(*) FROM schools s WHERE s.country_id IS NULL
                       OR NOT EXISTS (SELECT 1 FROM countries c WHERE c.id = s.country_id)) > 0 THEN 'WARN'
              ELSE 'GO' END,
         CASE WHEN to_regclass('public.schools') IS NULL THEN 'table schools absente'
              ELSE (SELECT count(*) FROM schools s WHERE s.country_id IS NULL
                       OR NOT EXISTS (SELECT 1 FROM countries c WHERE c.id = s.country_id))::text
                   || ' établissement(s) sans pays reconnu (aucun modèle proposé : fail-closed) sur '
                   || (SELECT count(*) FROM schools)::text END
  UNION ALL
  SELECT 9, 'P09 tables du catalogue',
         CASE WHEN (SELECT present FROM catalog_present) = 0 THEN 'GO'
              WHEN (SELECT present FROM catalog_present) = (SELECT total FROM catalog_present) THEN 'WARN'
              ELSE 'NO-GO' END,
         CASE WHEN (SELECT present FROM catalog_present) = 0 THEN 'absentes (0/3) : migration à appliquer — explique le 503 CATALOG_UNAVAILABLE'
              WHEN (SELECT present FROM catalog_present) = (SELECT total FROM catalog_present) THEN 'déjà présentes (3/3) : migration idempotente, rien à créer'
              ELSE 'état partiel : ' || (SELECT string_agg(name || '=' || CASE WHEN ref IS NULL THEN 'absente' ELSE 'présente' END, ', ') FROM catalog_tables) END
  UNION ALL
  SELECT 10, 'P10 objets en conflit',
         CASE WHEN (SELECT n FROM foreign_objects) = 0 THEN 'GO' ELSE 'NO-GO' END,
         coalesce((SELECT names FROM foreign_objects), 'aucun objet report_card_catalog* inattendu')
  UNION ALL
  SELECT 11, 'P11 tables préalables (créées au démarrage)',
         CASE WHEN (SELECT n FROM missing_prerequisites) = 0 THEN 'GO' ELSE 'NO-GO' END,
         coalesce('absentes : ' || (SELECT names FROM missing_prerequisites), 'toutes présentes (LOT 1→6, publication, référentiels)')
  UNION ALL
  SELECT 12, 'P12 hiérarchie des matières (20261103)',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subjects' AND column_name = 'parent_subject_id')
               AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subjects' AND column_name = 'display_order')
              THEN 'GO' ELSE 'NO-GO' END,
         'subjects.parent_subject_id et subjects.display_order requis par la configuration école'
  UNION ALL
  SELECT 13, 'P13 clés catalog-* déjà utilisées',
         CASE WHEN to_regclass('public.report_card_configuration_requests') IS NULL THEN 'NO-GO'
              WHEN (SELECT count(*) FROM report_card_configuration_requests WHERE model_key LIKE 'catalog-%') = 0 THEN 'GO'
              ELSE 'WARN' END,
         CASE WHEN to_regclass('public.report_card_configuration_requests') IS NULL THEN '—'
              ELSE (SELECT count(*) FROM report_card_configuration_requests WHERE model_key LIKE 'catalog-%')::text
                   || ' demande(s) avec une clé catalog-* (attendu 0 avant la première ouverture)' END
  UNION ALL
  SELECT 14, 'P14 transactions longues',
         CASE WHEN (SELECT count(*) FROM pg_stat_activity
                     WHERE datname = current_database() AND pid <> pg_backend_pid()
                       AND state <> 'idle' AND xact_start < now() - interval '5 minutes') = 0 THEN 'GO' ELSE 'WARN' END,
         (SELECT count(*) FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
             AND state <> 'idle' AND xact_start < now() - interval '5 minutes')::text
         || ' transaction(s) de plus de 5 min (les clés étrangères vers countries prennent un verrou SHARE ROW EXCLUSIVE bref)'
)
SELECT "check", status, detail
  FROM (
    SELECT ord, "check", status, detail FROM checks
    UNION ALL
    SELECT 99, 'VERDICT',
           CASE WHEN bool_or(status = 'NO-GO') THEN 'NO-GO' WHEN bool_or(status = 'WARN') THEN 'GO (avec réserves)' ELSE 'GO' END,
           count(*) FILTER (WHERE status = 'NO-GO')::text || ' bloquant(s), ' || count(*) FILTER (WHERE status = 'WARN')::text || ' réserve(s)'
      FROM checks
  ) report
 ORDER BY ord;
\else
SELECT 'P00 tables de base' AS "check", 'NO-GO' AS status,
       'countries, schools ou report_card_configuration_requests absente : base non initialisée ou mauvaise base' AS detail
UNION ALL
SELECT 'VERDICT', 'NO-GO', 'base non conforme';
\endif

\if :has_catalog
-- Catalogue déjà présent : structure et modèles existants.
SELECT table_name, string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS colonnes
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name LIKE 'report\_card\_catalog%'
 GROUP BY table_name ORDER BY table_name;
SELECT model_id, version, status, presentation_style FROM report_card_catalog_models ORDER BY model_id;
SELECT m.model_id, c.iso_code, a.available, a.updated_at
  FROM report_card_catalog_availability a
  JOIN report_card_catalog_models m ON m.model_id = a.model_id
  JOIN countries c ON c.id = a.country_id
 ORDER BY m.model_id, c.iso_code;
\endif

ROLLBACK;
