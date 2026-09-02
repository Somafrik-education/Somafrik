-- P0-B/C : contrat structurel des classes (niveau / filière / groupe).
-- Colonnes NULLABLES pour les classes existantes (lot E : diagnostic, pas de backfill silencieux).
-- Les nouvelles écritures exigent level_id + group_code côté application.

ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES education_levels(id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS stream_id UUID REFERENCES education_streams(id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_structural_offering
  ON classes (
    school_id,
    academic_year_id,
    level_id,
    COALESCE(stream_id, '00000000-0000-0000-0000-000000000000'::uuid),
    upper(btrim(group_code))
  )
  WHERE level_id IS NOT NULL;
