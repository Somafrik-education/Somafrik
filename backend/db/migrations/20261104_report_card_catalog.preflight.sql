-- BULLETIN-PREPROD-01 — préflight NON DESTRUCTIF de 20261104_report_card_catalog.sql.
--
-- Lecture seule : transaction READ ONLY terminée par ROLLBACK. Aucune écriture,
-- aucun verrou exclusif, aucun DDL. À exécuter AVANT toute décision d'application.
--
--   psql "$PREPROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--        -v expected_db='<nom exact de la base de préproduction>' \
--        -f backend/db/migrations/20261104_report_card_catalog.preflight.sql
--
-- IMPORTANT (BULLETIN-PREPROD-02) : exécuter avec la chaîne de connexion EFFECTIVEMENT
-- utilisée par l'API (somafrik-api-preprod) : current_user = rôle applicatif contrôlé.
-- Relancer APRÈS la migration : P16–P19 vérifient alors les privilèges réels du rôle.
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
role_info AS (
  SELECT r.rolname, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user
),
-- Privilèges indispensables au rôle applicatif (reportCardCatalogPgStore).
required_privileges(rel, priv) AS (
  VALUES ('report_card_catalog_models', 'SELECT'),
         ('report_card_catalog_availability', 'SELECT'), ('report_card_catalog_availability', 'INSERT'), ('report_card_catalog_availability', 'UPDATE'),
         ('report_card_catalog_availability_audit', 'SELECT'), ('report_card_catalog_availability_audit', 'INSERT')
),
missing_privileges AS (
  SELECT string_agg(rel || ':' || priv, ', ' ORDER BY rel, priv) AS names, count(*) AS n
    FROM required_privileges
   WHERE NOT coalesce(has_table_privilege(current_user, to_regclass('public.' || rel), priv), false)
),
sequence_privilege AS (
  SELECT coalesce(has_sequence_privilege(current_user, to_regclass('public.report_card_catalog_availability_audit_id_seq'), 'USAGE'), false) AS ok
),
rls_tables AS (
  SELECT e.name, c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner
    FROM expected_tables e LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.name)
),
-- Une opération passe RLS si le rôle est propriétaire (sans FORCE), ou si une politique
-- couvre la commande pour ce rôle (ou PUBLIC). BYPASSRLS n'est PAS retenu comme garantie.
uncovered_policies AS (
  SELECT string_agg(rp.rel || ':' || rp.priv, ', ' ORDER BY rp.rel, rp.priv) AS names, count(*) AS n
    FROM required_privileges rp
    JOIN pg_class c ON c.oid = to_regclass('public.' || rp.rel)
   WHERE c.relrowsecurity
     AND NOT (pg_get_userbyid(c.relowner) = current_user AND NOT c.relforcerowsecurity)
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = rp.rel
          AND p.cmd IN (rp.priv, 'ALL')
          AND (current_user = ANY (p.roles) OR 'public' = ANY (p.roles))
     )
),
public_exposure AS (
  SELECT string_agg(r.rolname || '→' || e.name, ', ' ORDER BY r.rolname, e.name) AS names, count(*) AS n
    FROM pg_roles r CROSS JOIN expected_tables e
   WHERE r.rolname IN ('anon', 'authenticated')
     AND to_regclass('public.' || e.name) IS NOT NULL
     AND (has_table_privilege(r.rolname, to_regclass('public.' || e.name), 'SELECT')
       OR has_table_privilege(r.rolname, to_regclass('public.' || e.name), 'INSERT')
       OR has_table_privilege(r.rolname, to_regclass('public.' || e.name), 'UPDATE')
       OR has_table_privilege(r.rolname, to_regclass('public.' || e.name), 'DELETE'))
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
              WHEN (SELECT present FROM catalog_present) > 0 THEN 'GO'
              ELSE 'WARN' END,
         'search_path = ' || current_setting('search_path')
         || ' ; droit CREATE sur public pour ' || current_user || ' : '
         || CASE WHEN to_regnamespace('public') IS NOT NULL AND has_schema_privilege(current_user, 'public', 'CREATE') THEN 'oui' ELSE 'non' END
         || CASE WHEN (SELECT present FROM catalog_present) = 0 AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
                 THEN ' — ce rôle ne peut pas appliquer la migration : l''appliquer avec un rôle administrateur ET somafrik.catalog_app_role=' || current_user
                 ELSE '' END
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
         -- pg_attribute (et non information_schema) : indépendant des privilèges du rôle connecté.
         CASE WHEN (SELECT count(*) FROM pg_attribute
                     WHERE attrelid = to_regclass('public.subjects') AND NOT attisdropped
                       AND attname IN ('parent_subject_id', 'display_order')) = 2
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
  UNION ALL
  SELECT 15, 'P15 rôle applicatif connecté',
         CASE WHEN lower(current_user) IN ('anon', 'authenticated') THEN 'NO-GO'
              WHEN (SELECT rolbypassrls OR rolsuper FROM role_info) THEN 'WARN'
              ELSE 'GO' END,
         current_user || ' (superuser : ' || CASE WHEN (SELECT rolsuper FROM role_info) THEN 'oui' ELSE 'non' END
         || ', BYPASSRLS : ' || CASE WHEN (SELECT rolbypassrls FROM role_info) THEN 'oui' ELSE 'non' END
         || ') — doit être le rôle de DATABASE_URL de l''API ; BYPASSRLS n''est pas retenu comme garantie'
  UNION ALL
  SELECT 16, 'P16 privilèges du rôle applicatif',
         CASE WHEN (SELECT present FROM catalog_present) < 3 THEN 'GO'
              WHEN (SELECT n FROM missing_privileges) = 0 AND (SELECT ok FROM sequence_privilege) THEN 'GO'
              ELSE 'NO-GO' END,
         CASE WHEN (SELECT present FROM catalog_present) < 3 THEN 'catalogue non installé : relancer le préflight après la migration'
              WHEN (SELECT n FROM missing_privileges) = 0 AND (SELECT ok FROM sequence_privilege) THEN 'SELECT/INSERT/UPDATE requis et USAGE séquence : accordés à ' || current_user
              ELSE 'manquants pour ' || current_user || ' : ' || concat_ws(', ', (SELECT names FROM missing_privileges),
                     CASE WHEN NOT (SELECT ok FROM sequence_privilege) THEN 'séquence:USAGE' END) END
  UNION ALL
  SELECT 17, 'P17 RLS activée (3 tables)',
         CASE WHEN (SELECT present FROM catalog_present) < 3 THEN 'GO'
              WHEN (SELECT bool_and(relrowsecurity) FROM rls_tables) THEN 'GO' ELSE 'NO-GO' END,
         CASE WHEN (SELECT present FROM catalog_present) < 3 THEN 'catalogue non installé'
              ELSE (SELECT string_agg(name || '=' || CASE WHEN relrowsecurity THEN 'RLS' ELSE 'sans RLS' END || ' (propriétaire ' || owner || ')', ', ') FROM rls_tables) END
  UNION ALL
  SELECT 18, 'P18 politiques RLS couvrant le rôle',
         CASE WHEN (SELECT present FROM catalog_present) < 3 THEN 'GO'
              WHEN (SELECT n FROM uncovered_policies) = 0 THEN 'GO' ELSE 'NO-GO' END,
         CASE WHEN (SELECT present FROM catalog_present) < 3 THEN 'catalogue non installé'
              WHEN (SELECT n FROM uncovered_policies) = 0 THEN 'chaque opération requise est couverte pour ' || current_user || ' (propriétaire ou politique)'
              ELSE 'opérations bloquées par RLS pour ' || current_user || ' : ' || (SELECT names FROM uncovered_policies) END
  UNION ALL
  SELECT 19, 'P19 aucun accès anon / authenticated',
         CASE WHEN (SELECT n FROM public_exposure) = 0 THEN 'GO' ELSE 'NO-GO' END,
         coalesce('accès direct détecté : ' || (SELECT names FROM public_exposure), 'aucun privilège anon/authenticated sur le catalogue')
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
