-- LOT Parents & élèves — contraintes canoniques (fail-safe).
-- Aucune suppression automatique de doublons historiques.
-- L'inventaire applicatif (ensureParentLinkingConstraints) doit précéder
-- la création des index si des collisions existent.

ALTER TABLE contact_relations
  DROP CONSTRAINT IF EXISTS contact_relations_school_id_contact_id_student_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_school_user_active
  ON contacts (school_id, user_id)
  WHERE user_id IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_relations_active
  ON contact_relations (school_id, contact_id, student_id)
  WHERE status = 'active';
