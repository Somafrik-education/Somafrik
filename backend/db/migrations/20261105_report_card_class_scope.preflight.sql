-- BULLETIN-CLASSE-01 / L1 — préflight NON DESTRUCTIF de 20261105_report_card_class_scope.sql.
--
-- Lecture seule : transaction READ ONLY terminée par ROLLBACK, délais courts, aucun DDL/DML.
-- Utilisable AVANT (état « à appliquer ») et APRÈS (état « appliquée ») la migration.
--
--   psql "$PREPROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--        -v expected_db='<nom exact de la base>' -v expected_env='preprod' \
--        [-v expected_system_identifier='<identifiant relevé précédemment>'] \
--        -f backend/db/migrations/20261105_report_card_class_scope.preflight.sql
--
-- Supabase : la base s'appelle souvent « postgres » en préproduction ET en production ;
-- l'identité est donc confirmée par expected_env + l'identifiant système du cluster (P01).
-- Résultat : une ligne par contrôle (GO / WARN / NO-GO) puis VERDICT.

\set QUIET on
\pset pager off
\pset null '∅'
\set QUIET off

\if :{?expected_db}
\else
  \echo 'NO-GO : variable expected_db absente.'
  \quit
\endif
\if :{?expected_env}
\else
  \echo 'NO-GO : variable expected_env absente (preprod attendu).'
  \quit
\endif
\if :{?expected_system_identifier}
\else
  \set expected_system_identifier ''
\endif

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

SELECT to_regclass('public.report_card_active_bindings') IS NOT NULL
       AND to_regclass('public.report_card_configuration_requests') IS NOT NULL
       AND to_regclass('public.classes') IS NOT NULL
       AND to_regclass('public.academic_years') IS NOT NULL
       AND to_regclass('public.schools') IS NOT NULL AS has_core
\gset

\if :has_core
WITH
attr(rel, col) AS (
  VALUES ('report_card_active_bindings', 'id'), ('report_card_active_bindings', 'academic_year_id'),
         ('report_card_active_bindings', 'class_id'),
         ('report_card_configuration_requests', 'academic_year_id'), ('report_card_configuration_requests', 'class_id')
),
scope_columns AS (
  SELECT count(*) FILTER (WHERE a.attname IS NOT NULL) AS present, count(*) AS total
    FROM attr LEFT JOIN pg_attribute a
      ON a.attrelid = to_regclass('public.' || attr.rel) AND a.attname = attr.col AND NOT a.attisdropped
),
state AS (
  SELECT CASE WHEN present = 0 THEN 'TO_APPLY' WHEN present = total THEN 'APPLIED' ELSE 'PARTIAL' END AS value FROM scope_columns
),
binding_pk AS (
  SELECT string_agg(a.attname, ',' ORDER BY k.ord) AS cols
    FROM pg_constraint con
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
   WHERE con.conrelid = 'public.report_card_active_bindings'::regclass AND con.contype = 'p'
),
-- Définitions attendues (colonnes ordonnées, prédicat normalisé) et provenance L1.
expected_indexes(name, rel, cols, pred, l1) AS (
  VALUES ('uq_report_card_configuration_one_active', 'report_card_configuration_requests', 'school_id,model_key', 'status=''active''::text', false),
         ('uq_report_card_active_bindings_school', 'report_card_active_bindings', 'school_id,model_key', 'class_idisnull', true),
         ('uq_report_card_active_bindings_class', 'report_card_active_bindings', 'school_id,model_key,academic_year_id,class_id', 'class_idisnotnull', true),
         ('uq_report_card_configuration_one_active_school', 'report_card_configuration_requests', 'school_id,model_key', 'status=''active''::textandclass_idisnull', true),
         ('uq_report_card_configuration_one_active_class', 'report_card_configuration_requests', 'school_id,model_key,academic_year_id,class_id', 'status=''active''::textandclass_idisnotnull', true)
),
index_state AS (
  SELECT e.name, e.l1,
         CASE WHEN c.oid IS NULL THEN 'ABSENT'
              WHEN i.indrelid <> to_regclass('public.' || e.rel) OR NOT i.indisunique OR NOT i.indisvalid OR i.indexprs IS NOT NULL
                   OR (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                         FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) IS DISTINCT FROM e.cols
                   OR regexp_replace(replace(lower(coalesce(pg_get_expr(i.indpred, i.indrelid), '')), 'public.', ''), '[[:space:]()"]', '', 'g') <> e.pred
                THEN 'MISMATCH'
              WHEN e.l1 AND obj_description(c.oid, 'pg_class') IS DISTINCT FROM 'somafrik:bulletin-classe-01-l1' THEN 'FOREIGN'
              ELSE 'OK' END AS status
    FROM expected_indexes e
    LEFT JOIN pg_class c ON c.relname = e.name AND c.relnamespace = 'public'::regnamespace
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
),
expected_constraints(name, rel, def) AS (
  VALUES ('classes_id_year_school_unique', 'classes', 'uniqueid,academic_year_id,school_id'),
         ('report_card_active_bindings_scope_pair', 'report_card_active_bindings', 'checkclass_idisnull=academic_year_idisnull'),
         ('report_card_active_bindings_class_tenant', 'report_card_active_bindings', 'foreignkeyclass_id,academic_year_id,school_idreferencesclassesid,academic_year_id,school_id'),
         ('report_card_configuration_requests_scope_pair', 'report_card_configuration_requests', 'checkclass_idisnull=academic_year_idisnull'),
         ('report_card_configuration_requests_class_tenant', 'report_card_configuration_requests', 'foreignkeyclass_id,academic_year_id,school_idreferencesclassesid,academic_year_id,school_id')
),
constraint_state AS (
  SELECT e.name,
         CASE WHEN con.oid IS NULL THEN 'ABSENT'
              WHEN con.conrelid <> to_regclass('public.' || e.rel) OR NOT con.convalidated
                   OR regexp_replace(replace(lower(pg_get_constraintdef(con.oid)), 'public.', ''), '[[:space:]()"]', '', 'g') <> e.def THEN 'MISMATCH'
              WHEN obj_description(con.oid, 'pg_constraint') IS DISTINCT FROM 'somafrik:bulletin-classe-01-l1' THEN 'FOREIGN'
              ELSE 'OK' END AS status
    FROM expected_constraints e
    LEFT JOIN pg_constraint con ON con.conname = e.name AND con.connamespace = 'public'::regnamespace
),
column_state AS (
  SELECT attr.rel || '.' || attr.col AS name,
         CASE WHEN a.attname IS NULL THEN 'ABSENT'
              WHEN format_type(a.atttypid, a.atttypmod) <> 'uuid' THEN 'MISMATCH'
              WHEN col_description(a.attrelid, a.attnum) IS DISTINCT FROM 'somafrik:bulletin-classe-01-l1' THEN 'FOREIGN'
              ELSE 'OK' END AS status
    FROM attr LEFT JOIN pg_attribute a
      ON a.attrelid = to_regclass('public.' || attr.rel) AND a.attname = attr.col AND NOT a.attisdropped
),
l1_objects AS (
  SELECT name, status FROM index_state WHERE l1
  UNION ALL SELECT name, status FROM constraint_state
  UNION ALL SELECT name, status FROM column_state
),
historical_index AS (
  SELECT status FROM index_state WHERE name = 'uq_report_card_configuration_one_active'
),
pk_note AS (
  SELECT obj_description(oid, 'pg_constraint') AS note FROM pg_constraint
   WHERE conrelid = 'public.report_card_active_bindings'::regclass AND contype = 'p'
),
bindings AS (
  SELECT count(*) AS n, count(DISTINCT school_id) AS schools FROM report_card_active_bindings
),
binding_duplicates AS (
  SELECT count(*) AS n FROM (
    SELECT school_id, model_key FROM report_card_active_bindings GROUP BY school_id, model_key HAVING count(*) > 1
  ) d
),
active_request_duplicates AS (
  SELECT count(*) AS n FROM (
    SELECT school_id, model_key FROM report_card_configuration_requests WHERE status = 'ACTIVE'
     GROUP BY school_id, model_key HAVING count(*) > 1
  ) d
),
class_year_mismatch AS (
  SELECT count(*) AS n FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
   WHERE y.school_id IS DISTINCT FROM c.school_id
),
classes_unique_conflict AS (
  -- Un nom de contrainte réservé par L1 déjà utilisé autrement = conflit.
  SELECT count(*) AS n FROM pg_constraint
   WHERE conname IN ('classes_id_year_school_unique', 'report_card_active_bindings_scope_pair',
                     'report_card_active_bindings_class_tenant', 'report_card_configuration_requests_scope_pair',
                     'report_card_configuration_requests_class_tenant')
     AND conrelid NOT IN ('public.classes'::regclass, 'public.report_card_active_bindings'::regclass,
                          'public.report_card_configuration_requests'::regclass)
),
fk_existing AS (
  SELECT count(*) AS n FROM pg_constraint
   WHERE conname IN ('report_card_active_bindings_request_tenant', 'report_card_configuration_requests_template_tenant')
),
fk_referencing_bindings AS (
  SELECT count(*) AS n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.report_card_active_bindings'::regclass
),
long_tx AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'
     AND xact_start < now() - interval '5 minutes'
),
held_locks AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.pid <> pg_backend_pid() AND l.granted
     AND l.relation IN ('public.report_card_active_bindings'::regclass, 'public.report_card_configuration_requests'::regclass,
                        'public.classes'::regclass)
     AND l.mode IN ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')
),
owners AS (
  SELECT bool_and(pg_get_userbyid(c.relowner) = current_user
                  OR pg_has_role(current_user, c.relowner, 'MEMBER')) AS ok,
         string_agg(c.relname || '→' || pg_get_userbyid(c.relowner), ', ' ORDER BY c.relname) AS detail
    FROM pg_class c
   WHERE c.oid IN ('public.report_card_active_bindings'::regclass, 'public.report_card_configuration_requests'::regclass,
                   'public.classes'::regclass)
),
app_privileges AS (
  SELECT has_table_privilege(current_user, 'public.report_card_active_bindings', 'SELECT')
     AND has_table_privilege(current_user, 'public.report_card_active_bindings', 'INSERT')
     AND has_table_privilege(current_user, 'public.report_card_active_bindings', 'UPDATE')
     AND has_table_privilege(current_user, 'public.report_card_configuration_requests', 'SELECT')
     AND has_table_privilege(current_user, 'public.report_card_configuration_requests', 'UPDATE')
     AND has_table_privilege(current_user, 'public.classes', 'SELECT') AS ok
),
public_exposure AS (
  SELECT string_agg(r.rolname || '→' || t.name, ', ' ORDER BY r.rolname, t.name) AS names, count(*) AS n
    FROM pg_roles r
    CROSS JOIN (VALUES ('report_card_active_bindings'), ('report_card_configuration_requests')) AS t(name)
   WHERE r.rolname IN ('anon', 'authenticated')
     AND (has_table_privilege(r.rolname, 'public.' || t.name, 'SELECT')
       OR has_table_privilege(r.rolname, 'public.' || t.name, 'INSERT')
       OR has_table_privilege(r.rolname, 'public.' || t.name, 'UPDATE'))
),
system_id AS (
  SELECT CASE WHEN has_function_privilege('pg_control_system()', 'EXECUTE')
              THEN (SELECT system_identifier::text FROM pg_control_system()) END AS value
),
checks(ord, "check", status, detail) AS (
  SELECT 1, 'P01 base et cluster cibles',
         CASE WHEN current_database() <> :'expected_db' THEN 'NO-GO'
              WHEN :'expected_system_identifier' <> '' AND (SELECT value FROM system_id) IS DISTINCT FROM :'expected_system_identifier' THEN 'NO-GO'
              WHEN :'expected_system_identifier' = '' THEN 'WARN'
              ELSE 'GO' END,
         'base « ' || current_database() || ' » (attendue « ' || :'expected_db' || ' ») ; cluster '
         || coalesce((SELECT value FROM system_id), 'identifiant non lisible') || ' ; serveur '
         || coalesce(host(inet_server_addr()), 'socket') || ':' || coalesce(inet_server_port()::text, '?') || ' ; rôle ' || current_user
         || CASE WHEN :'expected_system_identifier' = '' THEN ' — fournir expected_system_identifier pour distinguer préproduction / production' ELSE '' END
  UNION ALL
  SELECT 2, 'P02 environnement déclaré',
         CASE WHEN lower(:'expected_env') = 'preprod' THEN 'GO' ELSE 'NO-GO' END,
         'expected_env = ' || :'expected_env' || ' (L1 : préproduction uniquement, aucune intervention en production)'
  UNION ALL
  SELECT 3, 'P03 lecture seule', CASE WHEN current_setting('transaction_read_only') = 'on' THEN 'GO' ELSE 'NO-GO' END,
         'transaction_read_only = ' || current_setting('transaction_read_only')
  UNION ALL
  SELECT 4, 'P04 version PostgreSQL',
         CASE WHEN current_setting('server_version_num')::int >= 170000 THEN 'GO'
              WHEN current_setting('server_version_num')::int >= 120000 THEN 'WARN' ELSE 'NO-GO' END,
         current_setting('server_version') || ' (attendu 17.x, compatible ≥ 12)'
  UNION ALL
  SELECT 5, 'P05 état de la migration',
         CASE WHEN (SELECT value FROM state) = 'PARTIAL' THEN 'NO-GO' ELSE 'GO' END,
         CASE (SELECT value FROM state)
           WHEN 'TO_APPLY' THEN 'colonnes de portée absentes : migration à appliquer'
           WHEN 'APPLIED' THEN 'colonnes de portée présentes : migration appliquée (ré-exécution sans effet)'
           ELSE 'état partiel : ' || (SELECT present FROM scope_columns) || '/' || (SELECT total FROM scope_columns) || ' colonnes' END
  UNION ALL
  SELECT 6, 'P06 clé primaire des liaisons',
         CASE WHEN (SELECT value FROM state) = 'TO_APPLY' AND (SELECT cols FROM binding_pk) = 'school_id,model_key' THEN 'GO'
              WHEN (SELECT value FROM state) = 'APPLIED' AND (SELECT cols FROM binding_pk) = 'id'
                   AND (SELECT note FROM pk_note) = 'somafrik:bulletin-classe-01-l1' THEN 'GO'
              ELSE 'NO-GO' END,
         'PK actuelle : (' || coalesce((SELECT cols FROM binding_pk), 'aucune') || ')'
         || CASE WHEN (SELECT cols FROM binding_pk) = 'id' AND (SELECT note FROM pk_note) IS DISTINCT FROM 'somafrik:bulletin-classe-01-l1'
                 THEN ' — clé (id) non créée par L1' ELSE '' END
  UNION ALL
  SELECT 7, 'P07 définitions des index d''unicité',
         CASE WHEN (SELECT value FROM state) = 'TO_APPLY' AND (SELECT status FROM historical_index) = 'OK'
                   AND NOT EXISTS (SELECT 1 FROM index_state WHERE l1 AND status <> 'ABSENT') THEN 'GO'
              WHEN (SELECT value FROM state) = 'APPLIED' AND (SELECT status FROM historical_index) = 'ABSENT'
                   AND NOT EXISTS (SELECT 1 FROM index_state WHERE l1 AND status <> 'OK') THEN 'GO'
              ELSE 'NO-GO' END,
         'index historique : ' || (SELECT status FROM historical_index) || ' ; '
         || (SELECT string_agg(name || '=' || status, ', ' ORDER BY name) FROM index_state WHERE l1)
         || CASE WHEN (SELECT value FROM state) = 'APPLIED' AND (SELECT status FROM historical_index) <> 'ABSENT'
                 THEN ' — index historique présent après migration (ancien code redémarré ?)' ELSE '' END
  UNION ALL
  SELECT 8, 'P08 liaisons existantes', 'GO',
         (SELECT n FROM bindings) || ' liaison(s) active(s) pour ' || (SELECT schools FROM bindings) || ' établissement(s) : conservées telles quelles'
  UNION ALL
  SELECT 9, 'P09 doublons',
         CASE WHEN (SELECT value FROM state) = 'TO_APPLY'
                   AND ((SELECT n FROM binding_duplicates) > 0 OR (SELECT n FROM active_request_duplicates) > 0) THEN 'NO-GO'
              ELSE 'GO' END,
         (SELECT n FROM binding_duplicates) || ' doublon(s) (school_id, model_key) de liaison ; '
         || (SELECT n FROM active_request_duplicates) || ' doublon(s) de demande ACTIVE'
         || CASE WHEN (SELECT value FROM state) = 'APPLIED' THEN ' (après migration : doublons légitimes entre établissement et classes)' ELSE '' END
  UNION ALL
  SELECT 10, 'P10 cohérence classes / années',
         CASE WHEN (SELECT n FROM class_year_mismatch) > 0 THEN 'WARN' ELSE 'GO' END,
         (SELECT n FROM class_year_mismatch) || ' classe(s) dont l''année appartient à un autre établissement (aucune liaison de classe possible pour elles)'
  UNION ALL
  SELECT 11, 'P11 clés étrangères et noms réservés',
         CASE WHEN (SELECT n FROM fk_existing) < 2 OR (SELECT n FROM classes_unique_conflict) > 0 OR (SELECT n FROM fk_referencing_bindings) > 0 THEN 'NO-GO' ELSE 'GO' END,
         'FK existantes conservées : ' || (SELECT n FROM fk_existing) || '/2 ; FK pointant vers les liaisons : ' || (SELECT n FROM fk_referencing_bindings)
         || ' (attendu 0) ; noms réservés en conflit : ' || (SELECT n FROM classes_unique_conflict)
  UNION ALL
  SELECT 12, 'P12 transactions longues et verrous',
         CASE WHEN (SELECT n FROM long_tx) > 0 OR (SELECT n FROM held_locks) > 0 THEN 'WARN' ELSE 'GO' END,
         (SELECT n FROM long_tx) || ' transaction(s) > 5 min ; ' || (SELECT n FROM held_locks)
         || ' verrou(s) bloquant(s) sur liaisons / demandes / classes (lock_timeout de la migration : 5 s)'
  UNION ALL
  SELECT 13, 'P13 droits du rôle connecté',
         CASE WHEN NOT (SELECT ok FROM app_privileges) THEN 'NO-GO' WHEN (SELECT value FROM state) = 'TO_APPLY' AND NOT (SELECT ok FROM owners) THEN 'WARN' ELSE 'GO' END,
         'lecture/écriture requises : ' || CASE WHEN (SELECT ok FROM app_privileges) THEN 'oui' ELSE 'NON' END
         || ' ; propriétaires : ' || (SELECT detail FROM owners)
         || CASE WHEN (SELECT value FROM state) = 'TO_APPLY' AND NOT (SELECT ok FROM owners) THEN ' — appliquer la migration avec le rôle propriétaire' ELSE '' END
  UNION ALL
  SELECT 14, 'P14 exposition anon / authenticated',
         CASE WHEN (SELECT n FROM public_exposure) > 0 THEN 'WARN' ELSE 'GO' END,
         coalesce('privilèges préexistants (non modifiés par L1, à traiter séparément) : ' || (SELECT names FROM public_exposure),
                  'aucun privilège anon/authenticated sur les liaisons et demandes')
  UNION ALL
  SELECT 16, 'P16 provenance et définitions des objets L1',
         CASE WHEN EXISTS (SELECT 1 FROM l1_objects WHERE status IN ('MISMATCH', 'FOREIGN')) THEN 'NO-GO'
              WHEN (SELECT value FROM state) = 'TO_APPLY' AND EXISTS (SELECT 1 FROM l1_objects WHERE status <> 'ABSENT') THEN 'NO-GO'
              WHEN (SELECT value FROM state) = 'APPLIED' AND EXISTS (SELECT 1 FROM l1_objects WHERE status <> 'OK') THEN 'NO-GO'
              ELSE 'GO' END,
         coalesce('objets en conflit (définition différente ou absence du marqueur L1, appartiennent à un autre chantier) : '
                  || (SELECT string_agg(name || '=' || status, ', ' ORDER BY name) FROM l1_objects WHERE status IN ('MISMATCH', 'FOREIGN')),
                  CASE (SELECT value FROM state) WHEN 'APPLIED' THEN 'tous les objets L1 présents, marqués et conformes'
                       ELSE 'aucun objet homonyme préexistant' END)
  UNION ALL
  SELECT 15, 'P15 migrations précédentes',
         CASE WHEN to_regclass('public.report_card_rendering_template_versions') IS NULL OR to_regclass('public.report_card_published_snapshots') IS NULL THEN 'NO-GO' ELSE 'GO' END,
         'LOT 6 / publication : ' || CASE WHEN to_regclass('public.report_card_published_snapshots') IS NOT NULL THEN 'présents' ELSE 'absents' END
         || ' ; catalogue #1051/#1053 : ' || CASE WHEN to_regclass('public.report_card_catalog_models') IS NOT NULL THEN 'installé (non modifié par L1)' ELSE 'non installé (indépendant de L1)' END
)
SELECT "check", status, detail
  FROM (
    SELECT ord, "check", status, detail FROM checks
    UNION ALL
    SELECT 99, 'VERDICT',
           CASE WHEN bool_or(status = 'NO-GO') THEN 'NO-GO' WHEN bool_or(status = 'WARN') THEN 'WARN' ELSE 'GO' END,
           count(*) FILTER (WHERE status = 'NO-GO') || ' bloquant(s), ' || count(*) FILTER (WHERE status = 'WARN') || ' réserve(s)'
      FROM checks
  ) report
 ORDER BY ord;
\else
SELECT 'P00 tables de base' AS "check", 'NO-GO' AS status,
       'report_card_active_bindings, report_card_configuration_requests, classes, academic_years ou schools absente' AS detail
UNION ALL
SELECT 'VERDICT', 'NO-GO', 'base non conforme';
\endif

ROLLBACK;
