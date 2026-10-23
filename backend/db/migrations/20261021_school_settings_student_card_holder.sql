-- CARTE-CYCLE-01 — titulaire de la carte scolaire (élève / étudiant).
-- NULL = non configuré : le titulaire est alors déduit du type d'établissement EXACT
-- (École primaire, Collège, Lycée → élève ; Université → étudiant), sinon non déterminé.
-- student_card_holder_levels : surcharges par niveau d'enseignement (établissements mixtes),
-- objet { "<education_levels.id>": "eleve" | "etudiant" }. Aucune carte existante n'est modifiée.

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS student_card_holder_kind TEXT,
  ADD COLUMN IF NOT EXISTS student_card_holder_levels JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE school_settings
    ADD CONSTRAINT school_settings_student_card_holder_kind_check
    CHECK (student_card_holder_kind IS NULL OR student_card_holder_kind IN ('eleve', 'etudiant'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE school_settings
    ADD CONSTRAINT school_settings_student_card_holder_levels_check
    CHECK (jsonb_typeof(student_card_holder_levels) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
