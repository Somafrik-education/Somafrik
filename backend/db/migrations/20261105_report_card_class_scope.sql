-- BULLETIN-CLASSE-01 / L1 — portée classe × année scolaire du stockage canonique des bulletins.
--
-- JAMAIS exécutée automatiquement (ni au démarrage, ni en CI hors bases jetables).
-- Application manuelle, après déploiement du code L1 et préflight GO :
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--        -f backend/db/migrations/20261105_report_card_class_scope.sql
--
-- Portée cible : school_id + model_key + academic_year_id + class_id.
--   - liaisons / demandes établissement (historiques) : class_id ET academic_year_id NULL ;
--   - liaisons / demandes de classe (L2) : class_id ET academic_year_id renseignés.
-- Garanties :
--   - aucune ligne supprimée ni modifiée (hors attribution d'une clé technique `id`) ;
--   - unicité établissement « une liaison par (school_id, model_key) » CONSERVÉE par un
--     index unique partiel créé AVANT le remplacement de la clé primaire ;
--   - cohérence classe ↔ année ↔ établissement garantie par clé étrangère composite ;
--   - clés étrangères existantes conservées ; aucun privilège ajouté (anon/authenticated inchangés) ;
--   - ré-exécutable : chaque étape est conditionnelle.
-- Rollback contrôlé : 20261105_report_card_class_scope.rollback.sql (refusé si des données de classe existent).

SELECT set_config('lock_timeout', '5s', true);
SELECT set_config('statement_timeout', '60s', true);

DO $class_scope$
BEGIN
  IF to_regclass('public.report_card_active_bindings') IS NULL
     OR to_regclass('public.report_card_configuration_requests') IS NULL
     OR to_regclass('public.classes') IS NULL THEN
    RAISE EXCEPTION 'CLASS_SCOPE_PREREQUISITES_MISSING : tables LOT 6 ou classes absentes';
  END IF;
END
$class_scope$;

-- 1. Colonnes de portée et clé technique.
ALTER TABLE report_card_active_bindings ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE report_card_active_bindings ADD COLUMN IF NOT EXISTS academic_year_id UUID;
ALTER TABLE report_card_active_bindings ADD COLUMN IF NOT EXISTS class_id UUID;
UPDATE report_card_active_bindings SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE report_card_active_bindings ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE report_card_active_bindings ALTER COLUMN id SET NOT NULL;

ALTER TABLE report_card_configuration_requests ADD COLUMN IF NOT EXISTS academic_year_id UUID;
ALTER TABLE report_card_configuration_requests ADD COLUMN IF NOT EXISTS class_id UUID;

-- 2. Contraintes de portée et intégrité référentielle classe ↔ année ↔ établissement.
DO $class_scope$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_id_year_school_unique'
                   AND conrelid = 'public.classes'::regclass) THEN
    ALTER TABLE classes ADD CONSTRAINT classes_id_year_school_unique UNIQUE (id, academic_year_id, school_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_card_active_bindings_scope_pair'
                   AND conrelid = 'public.report_card_active_bindings'::regclass) THEN
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_scope_pair
      CHECK ((class_id IS NULL) = (academic_year_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_card_active_bindings_class_tenant'
                   AND conrelid = 'public.report_card_active_bindings'::regclass) THEN
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_class_tenant
      FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes (id, academic_year_id, school_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_card_configuration_requests_scope_pair'
                   AND conrelid = 'public.report_card_configuration_requests'::regclass) THEN
    ALTER TABLE report_card_configuration_requests ADD CONSTRAINT report_card_configuration_requests_scope_pair
      CHECK ((class_id IS NULL) = (academic_year_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_card_configuration_requests_class_tenant'
                   AND conrelid = 'public.report_card_configuration_requests'::regclass) THEN
    ALTER TABLE report_card_configuration_requests ADD CONSTRAINT report_card_configuration_requests_class_tenant
      FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes (id, academic_year_id, school_id);
  END IF;
END
$class_scope$;

-- 3. Nouveaux invariants d'unicité (créés AVANT tout retrait d'ancienne garantie).
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_active_bindings_school
  ON report_card_active_bindings (school_id, model_key) WHERE class_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_active_bindings_class
  ON report_card_active_bindings (school_id, model_key, academic_year_id, class_id) WHERE class_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active_school
  ON report_card_configuration_requests (school_id, model_key) WHERE status = 'ACTIVE' AND class_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active_class
  ON report_card_configuration_requests (school_id, model_key, academic_year_id, class_id)
  WHERE status = 'ACTIVE' AND class_id IS NOT NULL;

-- 4. Remplacement des anciennes garanties, seulement si les nouvelles sont présentes et valides.
DO $class_scope$
DECLARE
  pk_columns text[];
BEGIN
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname IN ('uq_report_card_active_bindings_school', 'uq_report_card_active_bindings_class',
                           'uq_report_card_configuration_one_active_school', 'uq_report_card_configuration_one_active_class')
         AND i.indisunique AND i.indisvalid) <> 4 THEN
    RAISE EXCEPTION 'CLASS_SCOPE_UNIQUE_INDEXES_INVALID';
  END IF;

  SELECT array_agg(a.attname::text ORDER BY k.ord) INTO pk_columns
    FROM pg_constraint con
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
   WHERE con.conrelid = 'public.report_card_active_bindings'::regclass AND con.contype = 'p';

  IF pk_columns IS NULL THEN
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (id);
  ELSIF pk_columns = ARRAY['school_id', 'model_key'] THEN
    ALTER TABLE report_card_active_bindings DROP CONSTRAINT report_card_active_bindings_pkey;
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (id);
  ELSIF pk_columns <> ARRAY['id'] THEN
    RAISE EXCEPTION 'CLASS_SCOPE_UNEXPECTED_PRIMARY_KEY : %', pk_columns;
  END IF;
END
$class_scope$;

DROP INDEX IF EXISTS uq_report_card_configuration_one_active;

-- 5. Contrôle final : la migration n'est validée que si toutes les garanties sont en place.
DO $class_scope$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.report_card_active_bindings'::regclass AND con.contype = 'p'
       AND array_length(con.conkey, 1) = 1 AND a.attname = 'id'
  ) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_POSTCHECK_PRIMARY_KEY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_card_active_bindings_request_tenant') THEN
    RAISE EXCEPTION 'CLASS_SCOPE_POSTCHECK_EXISTING_FOREIGN_KEY';
  END IF;
  IF EXISTS (SELECT 1 FROM report_card_active_bindings WHERE id IS NULL) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_POSTCHECK_TECHNICAL_ID';
  END IF;
END
$class_scope$;
