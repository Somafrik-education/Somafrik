-- ID-CANONICAL-01B — plus d'alias login enseignant.
-- Aucune migration de données. Somafrik V2 ne conserve pas ENS-####.

DROP INDEX IF EXISTS idx_teachers_school_legacy_code;
ALTER TABLE teachers DROP COLUMN IF EXISTS legacy_teacher_code;
