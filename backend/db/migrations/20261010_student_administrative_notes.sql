-- FICHE-FIX-01 — notes administratives de la fiche élève.
-- Justification : aucune colonne PostgreSQL canonique ne porte ce texte.
--   student.observations n'existe que dans le modèle Web.
--   enrollments.close_notes / transfer_notes décrivent le cycle d'inscription.
--   Les observations de bulletin, de présence et les messages parents sont d'autres domaines.
-- Idempotent : schema.sql applique le même ALTER au boot (CREATE TABLE IF NOT EXISTS
-- ne fait pas évoluer une table déjà créée).

ALTER TABLE students ADD COLUMN IF NOT EXISTS administrative_notes TEXT;

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_administrative_notes_len_check;
ALTER TABLE students ADD CONSTRAINT students_administrative_notes_len_check
  CHECK (administrative_notes IS NULL OR char_length(administrative_notes) <= 2000);
