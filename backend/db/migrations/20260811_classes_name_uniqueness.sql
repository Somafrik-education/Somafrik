-- Migration : unicité atomique des classes (école + année + nom normalisé)
-- et contrainte de statut active|inactive.
-- Idempotente. Appliquée aussi au boot via PostgresRepository.ensureClassesDomainConstraints.

UPDATE classes
SET status = CASE
  WHEN lower(btrim(status)) IN ('active', 'actif') THEN 'active'
  WHEN lower(btrim(status)) IN ('inactive', 'inactif', 'archived', 'archivée', 'archivee') THEN 'inactive'
  ELSE 'inactive'
END
WHERE status IS NULL
   OR status NOT IN ('active', 'inactive');

DELETE FROM classes
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY school_id, academic_year_id, lower(btrim(name))
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      ) AS row_number
    FROM classes
  ) ranked
  WHERE ranked.row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_school_year_normalized_name
  ON classes (school_id, academic_year_id, (lower(btrim(name))));

DO $$ BEGIN
  ALTER TABLE classes
    ADD CONSTRAINT classes_status_check
    CHECK (status IN ('active', 'inactive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
