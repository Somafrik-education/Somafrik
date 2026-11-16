-- BULLETIN-MODEL-01 — retour arrière de 20261103_subject_hierarchy.sql.
-- À exécuter manuellement, uniquement sur décision CTO, APRÈS retrait du code
-- qui lit parent_subject_id (sinon la migration est réappliquée au démarrage).
-- Effet : les sous-matières redeviennent des matières de premier niveau.
-- Aucune matière, note ni évaluation n'est supprimée.

DROP TRIGGER IF EXISTS trg_subjects_hierarchy ON subjects;
DROP FUNCTION IF EXISTS somafrik_assert_subject_hierarchy();
DROP INDEX IF EXISTS idx_subjects_parent_subject_id;
DROP INDEX IF EXISTS uq_subjects_parent_child_name;
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_display_order_check;
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_parent_not_self;
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_parent_same_school_fk;
DROP INDEX IF EXISTS uq_subjects_school_id_id;
ALTER TABLE subjects DROP COLUMN IF EXISTS display_order;
ALTER TABLE subjects DROP COLUMN IF EXISTS parent_subject_id;
