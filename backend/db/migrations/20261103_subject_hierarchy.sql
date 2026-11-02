-- BULLETIN-MODEL-01 — hiérarchie matière principale → sous-matières.
--
-- Additive et idempotente : deux colonnes NULLABLE sur `subjects`, aucune
-- suppression, aucune réécriture de matières ni de notes existantes. Toutes les
-- matières existantes restent des matières de premier niveau (parent NULL).
--
-- - parent_subject_id : matière principale (même établissement, un seul niveau).
-- - display_order     : ordre d'affichage d'une sous-matière sous sa matière.
--
-- Tenant-safe : la clé étrangère composite (school_id, parent_subject_id)
-- interdit un parent appartenant à un autre établissement.
-- Retour arrière : voir 20261103_subject_hierarchy.rollback.sql.

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS parent_subject_id UUID;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS display_order INTEGER;

-- Cible de la clé étrangère composite (id est déjà unique : index sans risque).
CREATE UNIQUE INDEX IF NOT EXISTS uq_subjects_school_id_id ON subjects (school_id, id);

DO $subject_hierarchy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subjects_parent_same_school_fk') THEN
    ALTER TABLE subjects
      ADD CONSTRAINT subjects_parent_same_school_fk
      FOREIGN KEY (school_id, parent_subject_id) REFERENCES subjects (school_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subjects_parent_not_self') THEN
    ALTER TABLE subjects
      ADD CONSTRAINT subjects_parent_not_self CHECK (parent_subject_id IS NULL OR parent_subject_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subjects_display_order_check') THEN
    ALTER TABLE subjects
      ADD CONSTRAINT subjects_display_order_check CHECK (display_order IS NULL OR display_order >= 0);
  END IF;
END
$subject_hierarchy$;

-- Doublon de sous-matière : même nom (insensible à la casse et aux espaces) sous la même matière.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subjects_parent_child_name
  ON subjects (school_id, parent_subject_id, lower(btrim(name)))
  WHERE parent_subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subjects_parent_subject_id
  ON subjects (parent_subject_id)
  WHERE parent_subject_id IS NOT NULL;

-- Un seul niveau : un parent ne peut pas avoir de parent, une matière ayant des
-- sous-matières ne peut pas devenir sous-matière.
CREATE OR REPLACE FUNCTION somafrik_assert_subject_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.parent_subject_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM subjects p WHERE p.id = NEW.parent_subject_id AND p.parent_subject_id IS NOT NULL) THEN
      RAISE EXCEPTION 'SUBJECT_NESTING_TOO_DEEP' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM subjects c WHERE c.parent_subject_id = NEW.id) THEN
      RAISE EXCEPTION 'SUBJECT_NESTING_TOO_DEEP' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_subjects_hierarchy ON subjects;
CREATE TRIGGER trg_subjects_hierarchy
  BEFORE INSERT OR UPDATE OF parent_subject_id ON subjects
  FOR EACH ROW EXECUTE FUNCTION somafrik_assert_subject_hierarchy();
