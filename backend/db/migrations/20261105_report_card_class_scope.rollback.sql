-- BULLETIN-CLASSE-01 / L1 — retour arrière CONTRÔLÉ de 20261105_report_card_class_scope.sql.
--
-- JAMAIS automatique. Manuel, après préflight, dans une transaction :
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--        -f backend/db/migrations/20261105_report_card_class_scope.rollback.sql
--
-- REFUSÉ (exception, rien n'est modifié) dès qu'une liaison ou une demande de classe existe :
-- aucune configuration ne doit jamais être supprimée par ce script.
-- Préservés : liaisons et demandes établissement, publications (snapshots), versions de
-- profils, schémas et gabarits, audits, données scolaires. Seuls les colonnes de portée
-- (toutes NULL), la clé technique `id`, les index et contraintes ajoutés par L1 sont retirés.
-- Code applicatif : le code L1 fonctionne avant et après ce retour arrière.

SELECT set_config('lock_timeout', '5s', true);
SELECT set_config('statement_timeout', '60s', true);

DO $class_scope_rollback$
DECLARE
  has_binding_scope boolean := EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.report_card_active_bindings'::regclass
                                        AND attname = 'class_id' AND NOT attisdropped);
  has_request_scope boolean := EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.report_card_configuration_requests'::regclass
                                        AND attname = 'class_id' AND NOT attisdropped);
  scoped integer := 0;
BEGIN
  IF has_binding_scope THEN
    EXECUTE 'SELECT count(*) FROM report_card_active_bindings WHERE class_id IS NOT NULL OR academic_year_id IS NOT NULL' INTO scoped;
    IF scoped > 0 THEN
      RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_REFUSED : % liaison(s) de classe existante(s)', scoped;
    END IF;
  END IF;
  IF has_request_scope THEN
    EXECUTE 'SELECT count(*) FROM report_card_configuration_requests WHERE class_id IS NOT NULL OR academic_year_id IS NOT NULL' INTO scoped;
    IF scoped > 0 THEN
      RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_REFUSED : % demande(s) de classe existante(s)', scoped;
    END IF;
  END IF;
END
$class_scope_rollback$;

-- 1. Rétablir les garanties historiques AVANT de retirer les nouvelles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active
  ON report_card_configuration_requests (school_id, model_key)
  WHERE status = 'ACTIVE';

DO $class_scope_rollback$
DECLARE
  pk_columns text[];
BEGIN
  SELECT array_agg(a.attname::text ORDER BY k.ord) INTO pk_columns
    FROM pg_constraint con
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
   WHERE con.conrelid = 'public.report_card_active_bindings'::regclass AND con.contype = 'p';
  IF pk_columns = ARRAY['id'] THEN
    ALTER TABLE report_card_active_bindings DROP CONSTRAINT report_card_active_bindings_pkey;
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (school_id, model_key);
  ELSIF pk_columns IS NULL THEN
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (school_id, model_key);
  ELSIF pk_columns <> ARRAY['school_id', 'model_key'] THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_UNEXPECTED_PRIMARY_KEY : %', pk_columns;
  END IF;
END
$class_scope_rollback$;

-- 2. Retirer les ajouts L1 (index, contraintes, colonnes de portée vides, clé technique).
DROP INDEX IF EXISTS uq_report_card_active_bindings_school;
DROP INDEX IF EXISTS uq_report_card_active_bindings_class;
DROP INDEX IF EXISTS uq_report_card_configuration_one_active_school;
DROP INDEX IF EXISTS uq_report_card_configuration_one_active_class;
ALTER TABLE report_card_active_bindings DROP CONSTRAINT IF EXISTS report_card_active_bindings_class_tenant;
ALTER TABLE report_card_active_bindings DROP CONSTRAINT IF EXISTS report_card_active_bindings_scope_pair;
ALTER TABLE report_card_configuration_requests DROP CONSTRAINT IF EXISTS report_card_configuration_requests_class_tenant;
ALTER TABLE report_card_configuration_requests DROP CONSTRAINT IF EXISTS report_card_configuration_requests_scope_pair;
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_id_year_school_unique;
ALTER TABLE report_card_active_bindings DROP COLUMN IF EXISTS class_id;
ALTER TABLE report_card_active_bindings DROP COLUMN IF EXISTS academic_year_id;
ALTER TABLE report_card_active_bindings DROP COLUMN IF EXISTS id;
ALTER TABLE report_card_configuration_requests DROP COLUMN IF EXISTS class_id;
ALTER TABLE report_card_configuration_requests DROP COLUMN IF EXISTS academic_year_id;
