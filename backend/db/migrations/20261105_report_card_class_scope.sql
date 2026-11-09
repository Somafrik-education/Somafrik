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
--     index unique partiel créé et VALIDÉ (définition exacte) AVANT le remplacement de la PK ;
--   - cohérence classe ↔ année ↔ établissement garantie par clé étrangère composite ;
--   - clés étrangères existantes conservées ; aucun privilège ajouté (anon/authenticated inchangés).
-- Provenance : chaque objet créé par L1 (colonne, contrainte, index, PK technique) porte le
-- commentaire `somafrik:bulletin-classe-01-l1`. Un objet homonyme SANS ce marqueur, ou avec
-- une définition différente, appartient à un autre chantier : la migration s'arrête (exception,
-- transaction annulée) au lieu de l'adopter. Le rollback ne supprime que les objets marqués.
-- Ré-exécutable : un objet marqué et conforme est conservé tel quel.
-- Rollback contrôlé : 20261105_report_card_class_scope.rollback.sql.

SELECT set_config('lock_timeout', '5s', true);
SELECT set_config('statement_timeout', '60s', true);

-- Outils de transaction (schéma temporaire de la session : aucun objet persistant).
CREATE FUNCTION pg_temp.l1_marker() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'somafrik:bulletin-classe-01-l1'::text $$;

CREATE FUNCTION pg_temp.l1_norm(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(replace(lower(coalesce(value, '')), 'public.', ''), '[[:space:]()"]', '', 'g')
$$;

-- Colonne : absente → false ; présente → doit être marquée et du type attendu, sinon exception.
CREATE FUNCTION pg_temp.l1_column_ready(rel regclass, col text, typ text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  found_type text;
  found_comment text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), col_description(a.attrelid, a.attnum)
    INTO found_type, found_comment
    FROM pg_attribute a WHERE a.attrelid = rel AND a.attname = col AND NOT a.attisdropped;
  IF NOT FOUND THEN RETURN false; END IF;
  IF found_comment IS DISTINCT FROM pg_temp.l1_marker() THEN
    RAISE EXCEPTION 'CLASS_SCOPE_FOREIGN_OBJECT : colonne %.% préexistante non créée par L1', rel, col;
  END IF;
  IF found_type <> typ THEN
    RAISE EXCEPTION 'CLASS_SCOPE_DEFINITION_MISMATCH : colonne %.% de type % (attendu %)', rel, col, found_type, typ;
  END IF;
  RETURN true;
END
$$;

-- Contrainte : absente → false ; présente → même table, même type, définition exacte, validée, marquée.
CREATE FUNCTION pg_temp.l1_constraint_ready(rel regclass, name text, kind "char", expected text, owned boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  con record;
BEGIN
  SELECT c.oid, c.conrelid, c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def, obj_description(c.oid, 'pg_constraint') AS note
    INTO con FROM pg_constraint c WHERE c.conname = name AND c.connamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RETURN false; END IF;
  IF con.conrelid <> rel OR con.contype <> kind OR NOT con.convalidated OR pg_temp.l1_norm(con.def) <> pg_temp.l1_norm(expected) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_DEFINITION_MISMATCH : contrainte % = « % » sur % (attendu « % » sur %)', name, con.def, con.conrelid::regclass, expected, rel;
  END IF;
  IF owned AND con.note IS DISTINCT FROM pg_temp.l1_marker() THEN
    RAISE EXCEPTION 'CLASS_SCOPE_FOREIGN_OBJECT : contrainte % préexistante non créée par L1', name;
  END IF;
  RETURN true;
END
$$;

-- Index : absent → false ; présent → même table, unique, valide, colonnes et prédicat exacts, sans expression, marqué.
CREATE FUNCTION pg_temp.l1_index_ready(rel regclass, name text, cols text[], predicate text, owned boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  idx record;
  found_cols text[];
BEGIN
  SELECT i.indexrelid, i.indrelid, i.indisunique, i.indisvalid, i.indexprs IS NULL AS plain,
         pg_get_expr(i.indpred, i.indrelid) AS pred, obj_description(i.indexrelid, 'pg_class') AS note
    INTO idx
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = name AND c.relnamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT array_agg(a.attname::text ORDER BY k.ord) INTO found_cols
    FROM unnest((SELECT indkey::int2[] FROM pg_index WHERE indexrelid = idx.indexrelid)) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = k.attnum;
  IF idx.indrelid <> rel OR NOT idx.indisunique OR NOT idx.indisvalid OR NOT idx.plain
     OR found_cols IS DISTINCT FROM cols OR pg_temp.l1_norm(idx.pred) <> pg_temp.l1_norm(predicate) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_DEFINITION_MISMATCH : index % = % sur % WHERE % (attendu % WHERE %)', name, found_cols, idx.indrelid::regclass, idx.pred, cols, predicate;
  END IF;
  IF owned AND idx.note IS DISTINCT FROM pg_temp.l1_marker() THEN
    RAISE EXCEPTION 'CLASS_SCOPE_FOREIGN_OBJECT : index % préexistant non créé par L1', name;
  END IF;
  RETURN true;
END
$$;

-- Colonnes de la clé primaire des liaisons (ordre conservé).
CREATE FUNCTION pg_temp.l1_binding_pk() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_agg(a.attname::text ORDER BY k.ord)
    FROM pg_constraint con
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
   WHERE con.conrelid = to_regclass('public.report_card_active_bindings') AND con.contype = 'p'
$$;

DO $class_scope$
DECLARE
  marker text := pg_temp.l1_marker();
  bindings regclass;
  requests regclass;
  classes_rel regclass;
  pk text[];
BEGIN
  bindings := to_regclass('public.report_card_active_bindings');
  requests := to_regclass('public.report_card_configuration_requests');
  classes_rel := to_regclass('public.classes');
  IF bindings IS NULL OR requests IS NULL OR classes_rel IS NULL THEN
    RAISE EXCEPTION 'CLASS_SCOPE_PREREQUISITES_MISSING : tables LOT 6 ou classes absentes';
  END IF;

  -- Contrats préexistants (non marqués, créés au démarrage) : vérifiés, jamais modifiés.
  PERFORM pg_temp.l1_constraint_ready(bindings, 'report_card_active_bindings_request_tenant', 'f',
    'FOREIGN KEY (request_id, school_id) REFERENCES report_card_configuration_requests(id, school_id)', false);
  pk := pg_temp.l1_binding_pk();
  IF pk IS DISTINCT FROM ARRAY['school_id', 'model_key'] AND pk IS DISTINCT FROM ARRAY['id'] THEN
    RAISE EXCEPTION 'CLASS_SCOPE_UNEXPECTED_PRIMARY_KEY : %', pk;
  END IF;
  IF pk = ARRAY['id'] THEN
    PERFORM pg_temp.l1_constraint_ready(bindings, 'report_card_active_bindings_pkey', 'p', 'PRIMARY KEY (id)');
  END IF;

  -- 1. Colonnes de portée et clé technique.
  IF NOT pg_temp.l1_column_ready(bindings, 'id', 'uuid') THEN
    ALTER TABLE report_card_active_bindings ADD COLUMN id UUID DEFAULT gen_random_uuid();
    EXECUTE format('COMMENT ON COLUMN report_card_active_bindings.id IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_column_ready(bindings, 'academic_year_id', 'uuid') THEN
    ALTER TABLE report_card_active_bindings ADD COLUMN academic_year_id UUID;
    EXECUTE format('COMMENT ON COLUMN report_card_active_bindings.academic_year_id IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_column_ready(bindings, 'class_id', 'uuid') THEN
    ALTER TABLE report_card_active_bindings ADD COLUMN class_id UUID;
    EXECUTE format('COMMENT ON COLUMN report_card_active_bindings.class_id IS %L', marker);
  END IF;
  UPDATE report_card_active_bindings SET id = gen_random_uuid() WHERE id IS NULL;
  ALTER TABLE report_card_active_bindings ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ALTER TABLE report_card_active_bindings ALTER COLUMN id SET NOT NULL;

  IF NOT pg_temp.l1_column_ready(requests, 'academic_year_id', 'uuid') THEN
    ALTER TABLE report_card_configuration_requests ADD COLUMN academic_year_id UUID;
    EXECUTE format('COMMENT ON COLUMN report_card_configuration_requests.academic_year_id IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_column_ready(requests, 'class_id', 'uuid') THEN
    ALTER TABLE report_card_configuration_requests ADD COLUMN class_id UUID;
    EXECUTE format('COMMENT ON COLUMN report_card_configuration_requests.class_id IS %L', marker);
  END IF;

  -- 2. Contraintes de portée et intégrité référentielle classe ↔ année ↔ établissement.
  IF NOT pg_temp.l1_constraint_ready(classes_rel, 'classes_id_year_school_unique', 'u', 'UNIQUE (id, academic_year_id, school_id)') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_id_year_school_unique UNIQUE (id, academic_year_id, school_id);
    EXECUTE format('COMMENT ON CONSTRAINT classes_id_year_school_unique ON classes IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_constraint_ready(bindings, 'report_card_active_bindings_scope_pair', 'c',
       'CHECK (((class_id IS NULL) = (academic_year_id IS NULL)))') THEN
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_scope_pair
      CHECK ((class_id IS NULL) = (academic_year_id IS NULL));
    EXECUTE format('COMMENT ON CONSTRAINT report_card_active_bindings_scope_pair ON report_card_active_bindings IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_constraint_ready(bindings, 'report_card_active_bindings_class_tenant', 'f',
       'FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes(id, academic_year_id, school_id)') THEN
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_class_tenant
      FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes (id, academic_year_id, school_id);
    EXECUTE format('COMMENT ON CONSTRAINT report_card_active_bindings_class_tenant ON report_card_active_bindings IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_constraint_ready(requests, 'report_card_configuration_requests_scope_pair', 'c',
       'CHECK (((class_id IS NULL) = (academic_year_id IS NULL)))') THEN
    ALTER TABLE report_card_configuration_requests ADD CONSTRAINT report_card_configuration_requests_scope_pair
      CHECK ((class_id IS NULL) = (academic_year_id IS NULL));
    EXECUTE format('COMMENT ON CONSTRAINT report_card_configuration_requests_scope_pair ON report_card_configuration_requests IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_constraint_ready(requests, 'report_card_configuration_requests_class_tenant', 'f',
       'FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes(id, academic_year_id, school_id)') THEN
    ALTER TABLE report_card_configuration_requests ADD CONSTRAINT report_card_configuration_requests_class_tenant
      FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes (id, academic_year_id, school_id);
    EXECUTE format('COMMENT ON CONSTRAINT report_card_configuration_requests_class_tenant ON report_card_configuration_requests IS %L', marker);
  END IF;

  -- 3. Nouveaux invariants d'unicité, créés puis VALIDÉS avant tout retrait d'ancienne garantie.
  IF NOT pg_temp.l1_index_ready(bindings, 'uq_report_card_active_bindings_school', ARRAY['school_id', 'model_key'], 'class_id IS NULL') THEN
    CREATE UNIQUE INDEX uq_report_card_active_bindings_school ON report_card_active_bindings (school_id, model_key) WHERE class_id IS NULL;
    EXECUTE format('COMMENT ON INDEX uq_report_card_active_bindings_school IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_index_ready(bindings, 'uq_report_card_active_bindings_class',
       ARRAY['school_id', 'model_key', 'academic_year_id', 'class_id'], 'class_id IS NOT NULL') THEN
    CREATE UNIQUE INDEX uq_report_card_active_bindings_class
      ON report_card_active_bindings (school_id, model_key, academic_year_id, class_id) WHERE class_id IS NOT NULL;
    EXECUTE format('COMMENT ON INDEX uq_report_card_active_bindings_class IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_index_ready(requests, 'uq_report_card_configuration_one_active_school', ARRAY['school_id', 'model_key'],
       'status = ''ACTIVE''::text AND class_id IS NULL') THEN
    CREATE UNIQUE INDEX uq_report_card_configuration_one_active_school
      ON report_card_configuration_requests (school_id, model_key) WHERE status = 'ACTIVE' AND class_id IS NULL;
    EXECUTE format('COMMENT ON INDEX uq_report_card_configuration_one_active_school IS %L', marker);
  END IF;
  IF NOT pg_temp.l1_index_ready(requests, 'uq_report_card_configuration_one_active_class',
       ARRAY['school_id', 'model_key', 'academic_year_id', 'class_id'], 'status = ''ACTIVE''::text AND class_id IS NOT NULL') THEN
    CREATE UNIQUE INDEX uq_report_card_configuration_one_active_class
      ON report_card_configuration_requests (school_id, model_key, academic_year_id, class_id)
      WHERE status = 'ACTIVE' AND class_id IS NOT NULL;
    EXECUTE format('COMMENT ON INDEX uq_report_card_configuration_one_active_class IS %L', marker);
  END IF;
  -- Validation définitive (chaque appel lève une exception en cas d'écart).
  IF NOT (pg_temp.l1_index_ready(bindings, 'uq_report_card_active_bindings_school', ARRAY['school_id', 'model_key'], 'class_id IS NULL')
      AND pg_temp.l1_index_ready(bindings, 'uq_report_card_active_bindings_class', ARRAY['school_id', 'model_key', 'academic_year_id', 'class_id'], 'class_id IS NOT NULL')
      AND pg_temp.l1_index_ready(requests, 'uq_report_card_configuration_one_active_school', ARRAY['school_id', 'model_key'], 'status = ''ACTIVE''::text AND class_id IS NULL')
      AND pg_temp.l1_index_ready(requests, 'uq_report_card_configuration_one_active_class', ARRAY['school_id', 'model_key', 'academic_year_id', 'class_id'], 'status = ''ACTIVE''::text AND class_id IS NOT NULL')) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_UNIQUE_INDEXES_INVALID';
  END IF;

  -- 4. Remplacement des anciennes garanties (seulement leur définition historique exacte).
  IF pk = ARRAY['school_id', 'model_key'] THEN
    PERFORM pg_temp.l1_constraint_ready(bindings, 'report_card_active_bindings_pkey', 'p', 'PRIMARY KEY (school_id, model_key)', false);
    ALTER TABLE report_card_active_bindings DROP CONSTRAINT report_card_active_bindings_pkey;
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (id);
    EXECUTE format('COMMENT ON CONSTRAINT report_card_active_bindings_pkey ON report_card_active_bindings IS %L', marker);
  END IF;
  IF pg_temp.l1_index_ready(requests, 'uq_report_card_configuration_one_active', ARRAY['school_id', 'model_key'], 'status = ''ACTIVE''::text', false) THEN
    DROP INDEX uq_report_card_configuration_one_active;
  END IF;

  -- 5. Contrôle final.
  IF NOT pg_temp.l1_constraint_ready(bindings, 'report_card_active_bindings_pkey', 'p', 'PRIMARY KEY (id)') THEN
    RAISE EXCEPTION 'CLASS_SCOPE_POSTCHECK_PRIMARY_KEY';
  END IF;
  IF EXISTS (SELECT 1 FROM report_card_active_bindings WHERE id IS NULL) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_POSTCHECK_TECHNICAL_ID';
  END IF;
END
$class_scope$;

DROP FUNCTION pg_temp.l1_binding_pk();
DROP FUNCTION pg_temp.l1_index_ready(regclass, text, text[], text, boolean);
DROP FUNCTION pg_temp.l1_constraint_ready(regclass, text, "char", text, boolean);
DROP FUNCTION pg_temp.l1_column_ready(regclass, text, text);
DROP FUNCTION pg_temp.l1_norm(text);
DROP FUNCTION pg_temp.l1_marker();
