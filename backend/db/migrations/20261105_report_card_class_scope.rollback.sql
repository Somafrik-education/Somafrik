-- BULLETIN-CLASSE-01 / L1 — retour arrière CONTRÔLÉ de 20261105_report_card_class_scope.sql.
--
-- JAMAIS automatique. Manuel, après préflight, dans une transaction :
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--        -f backend/db/migrations/20261105_report_card_class_scope.rollback.sql
--
-- REFUSÉ (exception, rien n'est modifié) :
--   - dès qu'une liaison ou une demande de classe existe (aucune configuration n'est supprimée) ;
--   - dès qu'un objet portant un nom L1 n'a PAS le marqueur de provenance
--     `somafrik:bulletin-classe-01-l1` ou n'a pas la définition L1 : il appartient à un autre
--     chantier et ne doit jamais être supprimé.
-- Seuls les objets marqués L1 sont retirés. Préservés : liaisons et demandes établissement,
-- publications (snapshots), versions de profils, schémas et gabarits, audits, données scolaires.
-- Code applicatif : le code L1 fonctionne avant et après ce retour arrière.

SELECT set_config('lock_timeout', '5s', true);
SELECT set_config('statement_timeout', '60s', true);

CREATE FUNCTION pg_temp.l1_marker() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'somafrik:bulletin-classe-01-l1'::text $$;

CREATE FUNCTION pg_temp.l1_norm(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(replace(lower(coalesce(value, '')), 'public.', ''), '[[:space:]()"]', '', 'g')
$$;

-- Contrainte L1 : absente → false ; marquée et conforme → true ; sinon exception (objet d'un autre chantier).
CREATE FUNCTION pg_temp.l1_owned_constraint(rel regclass, name text, expected text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  con record;
BEGIN
  SELECT c.conrelid, c.convalidated, pg_get_constraintdef(c.oid) AS def, obj_description(c.oid, 'pg_constraint') AS note
    INTO con FROM pg_constraint c WHERE c.conname = name AND c.connamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RETURN false; END IF;
  IF con.note IS DISTINCT FROM pg_temp.l1_marker() THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_FOREIGN_OBJECT : contrainte % (« % ») non créée par L1 : retour arrière refusé', name, con.def;
  END IF;
  IF con.conrelid <> rel OR NOT con.convalidated OR pg_temp.l1_norm(con.def) <> pg_temp.l1_norm(expected) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_DEFINITION_MISMATCH : contrainte % marquée L1 mais modifiée (« % » sur %) : retour arrière refusé', name, con.def, con.conrelid::regclass;
  END IF;
  RETURN true;
END
$$;

-- Index L1 : absent → false ; marqué ET définition L1 exacte (table, colonnes ordonnées, unique,
-- valide, sans expression, prédicat) → true ; sinon exception (modifié ou d'un autre chantier).
CREATE FUNCTION pg_temp.l1_owned_index(rel regclass, name text, cols text[], predicate text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  idx record;
  found_cols text[];
BEGIN
  SELECT i.indexrelid, i.indrelid, i.indisunique, i.indisvalid, i.indexprs IS NULL AS plain,
         pg_get_expr(i.indpred, i.indrelid) AS pred, obj_description(i.indexrelid, 'pg_class') AS note
    INTO idx FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = name AND c.relnamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT array_agg(a.attname::text ORDER BY k.ord) INTO found_cols
    FROM unnest((SELECT indkey::int2[] FROM pg_index WHERE indexrelid = idx.indexrelid)) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = k.attnum;
  IF idx.note IS DISTINCT FROM pg_temp.l1_marker() THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_FOREIGN_OBJECT : index % non créé par L1 : retour arrière refusé', name;
  END IF;
  IF idx.indrelid <> rel OR NOT idx.indisunique OR NOT idx.indisvalid OR NOT idx.plain
     OR found_cols IS DISTINCT FROM cols OR pg_temp.l1_norm(idx.pred) <> pg_temp.l1_norm(predicate) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_DEFINITION_MISMATCH : index % marqué L1 mais modifié (% sur % WHERE %) : retour arrière refusé',
      name, found_cols, idx.indrelid::regclass, idx.pred;
  END IF;
  RETURN true;
END
$$;

-- Colonne L1 : absente → false ; marquée ET de type uuid → true ; sinon exception.
CREATE FUNCTION pg_temp.l1_owned_column(rel regclass, col text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  note text;
  found_type text;
BEGIN
  SELECT col_description(a.attrelid, a.attnum), format_type(a.atttypid, a.atttypmod) INTO note, found_type
    FROM pg_attribute a WHERE a.attrelid = rel AND a.attname = col AND NOT a.attisdropped;
  IF NOT FOUND THEN RETURN false; END IF;
  IF note IS DISTINCT FROM pg_temp.l1_marker() THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_FOREIGN_OBJECT : colonne %.% non créée par L1 : retour arrière refusé', rel, col;
  END IF;
  IF found_type <> 'uuid' THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_DEFINITION_MISMATCH : colonne %.% marquée L1 mais de type % : retour arrière refusé', rel, col, found_type;
  END IF;
  RETURN true;
END
$$;

DO $class_scope_rollback$
DECLARE
  bindings regclass := to_regclass('public.report_card_active_bindings');
  requests regclass := to_regclass('public.report_card_configuration_requests');
  classes_rel regclass := to_regclass('public.classes');
  scoped integer := 0;
  pk text[];
  pk_note text;
  drop_pk boolean;
  drop_constraints text[] := ARRAY[]::text[];
  drop_indexes text[] := ARRAY[]::text[];
  drop_columns text[] := ARRAY[]::text[];
  item text;
BEGIN
  IF bindings IS NULL OR requests IS NULL OR classes_rel IS NULL THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_PREREQUISITES_MISSING';
  END IF;

  -- 1. Refus si des données de classe existent.
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = bindings AND attname = 'class_id' AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM report_card_active_bindings WHERE class_id IS NOT NULL OR academic_year_id IS NOT NULL' INTO scoped;
    IF scoped > 0 THEN RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_REFUSED : % liaison(s) de classe existante(s)', scoped; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = requests AND attname = 'class_id' AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM report_card_configuration_requests WHERE class_id IS NOT NULL OR academic_year_id IS NOT NULL' INTO scoped;
    IF scoped > 0 THEN RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_REFUSED : % demande(s) de classe existante(s)', scoped; END IF;
  END IF;

  -- 2. Inventaire de provenance AVANT toute modification (exception si objet étranger).
  IF pg_temp.l1_owned_constraint(bindings, 'report_card_active_bindings_class_tenant',
       'FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes(id, academic_year_id, school_id)') THEN
    drop_constraints := drop_constraints || 'report_card_active_bindings.report_card_active_bindings_class_tenant'::text;
  END IF;
  IF pg_temp.l1_owned_constraint(bindings, 'report_card_active_bindings_scope_pair', 'CHECK (((class_id IS NULL) = (academic_year_id IS NULL)))') THEN
    drop_constraints := drop_constraints || 'report_card_active_bindings.report_card_active_bindings_scope_pair'::text;
  END IF;
  IF pg_temp.l1_owned_constraint(requests, 'report_card_configuration_requests_class_tenant',
       'FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes(id, academic_year_id, school_id)') THEN
    drop_constraints := drop_constraints || 'report_card_configuration_requests.report_card_configuration_requests_class_tenant'::text;
  END IF;
  IF pg_temp.l1_owned_constraint(requests, 'report_card_configuration_requests_scope_pair', 'CHECK (((class_id IS NULL) = (academic_year_id IS NULL)))') THEN
    drop_constraints := drop_constraints || 'report_card_configuration_requests.report_card_configuration_requests_scope_pair'::text;
  END IF;
  IF pg_temp.l1_owned_constraint(classes_rel, 'classes_id_year_school_unique', 'UNIQUE (id, academic_year_id, school_id)') THEN
    drop_constraints := drop_constraints || 'classes.classes_id_year_school_unique'::text;
  END IF;
  IF pg_temp.l1_owned_index(bindings, 'uq_report_card_active_bindings_school', ARRAY['school_id', 'model_key'], 'class_id IS NULL') THEN
    drop_indexes := drop_indexes || 'uq_report_card_active_bindings_school'::text;
  END IF;
  IF pg_temp.l1_owned_index(bindings, 'uq_report_card_active_bindings_class', ARRAY['school_id', 'model_key', 'academic_year_id', 'class_id'], 'class_id IS NOT NULL') THEN
    drop_indexes := drop_indexes || 'uq_report_card_active_bindings_class'::text;
  END IF;
  IF pg_temp.l1_owned_index(requests, 'uq_report_card_configuration_one_active_school', ARRAY['school_id', 'model_key'], 'status = ''ACTIVE''::text AND class_id IS NULL') THEN
    drop_indexes := drop_indexes || 'uq_report_card_configuration_one_active_school'::text;
  END IF;
  IF pg_temp.l1_owned_index(requests, 'uq_report_card_configuration_one_active_class', ARRAY['school_id', 'model_key', 'academic_year_id', 'class_id'], 'status = ''ACTIVE''::text AND class_id IS NOT NULL') THEN
    drop_indexes := drop_indexes || 'uq_report_card_configuration_one_active_class'::text;
  END IF;
  FOREACH item IN ARRAY ARRAY['report_card_active_bindings.class_id', 'report_card_active_bindings.academic_year_id',
                              'report_card_configuration_requests.class_id', 'report_card_configuration_requests.academic_year_id'] LOOP
    IF pg_temp.l1_owned_column(to_regclass('public.' || split_part(item, '.', 1)), split_part(item, '.', 2)) THEN
      drop_columns := drop_columns || item;
    END IF;
  END LOOP;

  SELECT array_agg(a.attname::text ORDER BY k.ord), max(obj_description(con.oid, 'pg_constraint')) INTO pk, pk_note
    FROM pg_constraint con
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
   WHERE con.conrelid = bindings AND con.contype = 'p';
  IF pk = ARRAY['id'] THEN
    IF pk_note IS DISTINCT FROM pg_temp.l1_marker() THEN
      RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_FOREIGN_OBJECT : clé primaire (id) non créée par L1 : retour arrière refusé';
    END IF;
    drop_pk := true;
  ELSIF pk = ARRAY['school_id', 'model_key'] OR pk IS NULL THEN
    drop_pk := false;
  ELSE
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_UNEXPECTED_PRIMARY_KEY : %', pk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = bindings AND attname = 'id' AND NOT attisdropped) THEN
    PERFORM pg_temp.l1_owned_column(bindings, 'id');
  END IF;

  -- 3. Rétablir les garanties historiques AVANT de retirer les nouvelles.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active
    ON report_card_configuration_requests (school_id, model_key) WHERE status = 'ACTIVE';
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'uq_report_card_configuration_one_active' AND i.indrelid = requests AND i.indisunique AND i.indisvalid
       AND pg_temp.l1_norm(pg_get_expr(i.indpred, i.indrelid)) = pg_temp.l1_norm('status = ''ACTIVE''::text')
  ) THEN
    RAISE EXCEPTION 'CLASS_SCOPE_ROLLBACK_HISTORICAL_INDEX_MISMATCH';
  END IF;
  IF drop_pk THEN
    ALTER TABLE report_card_active_bindings DROP CONSTRAINT report_card_active_bindings_pkey;
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (school_id, model_key);
  ELSIF pk IS NULL THEN
    ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (school_id, model_key);
  END IF;

  -- 4. Retirer UNIQUEMENT les objets marqués L1 (contraintes avant index et colonnes).
  FOREACH item IN ARRAY drop_constraints LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', split_part(item, '.', 1), split_part(item, '.', 2));
  END LOOP;
  FOREACH item IN ARRAY drop_indexes LOOP
    EXECUTE format('DROP INDEX %I', item);
  END LOOP;
  FOREACH item IN ARRAY drop_columns LOOP
    EXECUTE format('ALTER TABLE %I DROP COLUMN %I', split_part(item, '.', 1), split_part(item, '.', 2));
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = bindings AND attname = 'id' AND NOT attisdropped) THEN
    ALTER TABLE report_card_active_bindings DROP COLUMN id;
  END IF;
END
$class_scope_rollback$;

DROP FUNCTION pg_temp.l1_owned_column(regclass, text);
DROP FUNCTION pg_temp.l1_owned_index(regclass, text, text[], text);
DROP FUNCTION pg_temp.l1_owned_constraint(regclass, text, text);
DROP FUNCTION pg_temp.l1_norm(text);
DROP FUNCTION pg_temp.l1_marker();
