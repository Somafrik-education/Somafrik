-- Migration : unicité atomique des classes (école + année + nom normalisé)
-- et contrainte de statut active|inactive.
-- Idempotente. Appliquée aussi au boot via PostgresRepository.ensureClassesDomainConstraints.
--
-- IMPORTANT :
-- 1) Ne crée PAS l'index dans schema.sql (ordre boot : schéma → migration contrôlée).
-- 2) Ne SUPPRIME JAMAIS les doublons automatiquement (fail-safe : diagnostic + arrêt).

UPDATE classes
SET status = CASE
  WHEN lower(btrim(status)) IN ('active', 'actif') THEN 'active'
  WHEN lower(btrim(status)) IN ('inactive', 'inactif', 'archived', 'archivée', 'archivee') THEN 'inactive'
  ELSE 'inactive'
END
WHERE status IS NULL
   OR status NOT IN ('active', 'inactive');

DO $$
DECLARE
  duplicate_groups integer := 0;
  sample text := '';
BEGIN
  SELECT COUNT(*)::int INTO duplicate_groups
  FROM (
    SELECT school_id, academic_year_id, lower(btrim(name)) AS normalized_name
    FROM classes
    GROUP BY school_id, academic_year_id, lower(btrim(name))
    HAVING COUNT(*) > 1
  ) d;

  IF duplicate_groups > 0 THEN
    SELECT string_agg(
      format(
        '%s/%s/%s×%s[%s]',
        school_code,
        academic_year_name,
        normalized_name,
        duplicate_count,
        class_codes
      ),
      '; '
    )
    INTO sample
    FROM (
      SELECT
        s.school_code,
        ay.name AS academic_year_name,
        lower(btrim(cl.name)) AS normalized_name,
        COUNT(*)::int AS duplicate_count,
        array_to_string(
          array_agg(cl.class_code ORDER BY cl.updated_at DESC NULLS LAST, cl.created_at DESC NULLS LAST, cl.id DESC),
          ','
        ) AS class_codes
      FROM classes cl
      JOIN schools s ON s.id = cl.school_id
      JOIN academic_years ay ON ay.id = cl.academic_year_id
      GROUP BY s.school_code, ay.name, lower(btrim(cl.name))
      HAVING COUNT(*) > 1
      ORDER BY s.school_code, ay.name, lower(btrim(cl.name))
      LIMIT 20
    ) samples;

    RAISE EXCEPTION
      'Classes : % groupe(s) en doublon de nom normalisé. Résolution explicite requise avant index unique uq_classes_school_year_normalized_name. Aucune suppression automatique. Exemples: %',
      duplicate_groups,
      COALESCE(sample, 'n/a');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_school_year_normalized_name
  ON classes (school_id, academic_year_id, (lower(btrim(name))));

DO $$ BEGIN
  ALTER TABLE classes
    ADD CONSTRAINT classes_status_check
    CHECK (status IN ('active', 'inactive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
