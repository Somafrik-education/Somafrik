-- LOT Parents & élèves — contraintes canoniques (fail-safe).
-- Aucune suppression automatique de doublons historiques.
-- Les index uniques NE sont PAS créés ici : un CREATE UNIQUE INDEX sur une
-- préprod avec doublons lèverait 23505 avant l'inventaire diagnostique.
-- Boot : ensureClientsCanonicalSchema() (tables) PUIS
-- ensureParentLinkingConstraints() (inventaire → index).

ALTER TABLE contact_relations
  DROP CONSTRAINT IF EXISTS contact_relations_school_id_contact_id_student_id_key;
