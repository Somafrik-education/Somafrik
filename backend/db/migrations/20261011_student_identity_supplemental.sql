-- FICHE-FIX-03 — appliquer avant de déployer le code qui lit les nouveaux champs.

-- FICHE-FIX-03 — compléments d'identité de l'élève (tenant students.school_id).
-- Champs distincts du nom légal et des coordonnées parentales ; null = non renseigné.
ALTER TABLE students ADD COLUMN IF NOT EXISTS preferred_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS nationality TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_preferred_name_len_check;
ALTER TABLE students ADD CONSTRAINT students_preferred_name_len_check
  CHECK (preferred_name IS NULL OR char_length(preferred_name) <= 120);
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_nationality_len_check;
ALTER TABLE students ADD CONSTRAINT students_nationality_len_check
  CHECK (nationality IS NULL OR char_length(nationality) <= 120);
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_address_len_check;
ALTER TABLE students ADD CONSTRAINT students_address_len_check
  CHECK (address IS NULL OR char_length(address) <= 500);
