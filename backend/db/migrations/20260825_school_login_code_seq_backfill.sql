-- OPT-IN ONLY. NE PAS inclure dans USER_ROLES_SCHEMA_SQL (boot).
--
-- Réécriture des schools.login_code déjà émis pour aligner SEQ3
-- sur un compteur global pays + année.
--
-- INTERDIT sans validation CTO : un code déjà communiqué publiquement
-- (ex. CD-ISDC-26-001) ne doit pas changer silencieusement.
--
-- Dry-run (recommandé) :
--   SELECT * FROM school_login_code_seq_backfill_preview
--   ORDER BY country_iso, created_year, proposed_seq;
--   node backend/scripts/audit-school-login-code-sequences.js
--
-- Apply (CTO seulement) :
--   SET somafrik.school_login_seq_backfill = 'APPLY_CTO_APPROVED';
--   puis exécuter ce fichier.
--
-- Stratégie recommandée : A — ne pas exécuter. Corriger seulement
-- les allocations futures. Conserver les codes déjà émis.
-- B = ce fichier. C = alias historique (hors scope).

DO $$
BEGIN
  IF current_setting('somafrik.school_login_seq_backfill', true)
       IS DISTINCT FROM 'APPLY_CTO_APPROVED' THEN
    RAISE EXCEPTION 'SCHOOL_LOGIN_SEQ_BACKFILL_DRY_RUN'
      USING HINT = 'Aucun login_code n''a été modifié. Pour appliquer (CTO) : SET somafrik.school_login_seq_backfill = ''APPLY_CTO_APPROVED''';
  END IF;
END $$;

BEGIN;

ALTER TABLE schools DISABLE TRIGGER USER;

WITH planned AS (
  SELECT id, proposed_login_code
  FROM school_login_code_seq_backfill_preview
  WHERE would_change
)
UPDATE schools s
SET login_code = p.proposed_login_code,
    updated_at = NOW()
FROM planned p
WHERE s.id = p.id;

INSERT INTO school_login_code_counters (country_id, creation_year, last_value)
SELECT
  s.country_id,
  extract(year FROM coalesce(s.created_at, NOW()))::integer,
  max(split_part(s.login_code, '-', 4)::integer)
FROM schools s
WHERE s.login_code ~ '^[A-Z]{2}-[A-Z0-9]{2,5}-[0-9]{2}-[0-9]{3}$'
GROUP BY
  s.country_id,
  extract(year FROM coalesce(s.created_at, NOW()))::integer
ON CONFLICT (country_id, creation_year)
DO UPDATE SET
  last_value = greatest(school_login_code_counters.last_value, EXCLUDED.last_value),
  updated_at = NOW();

ALTER TABLE schools ENABLE TRIGGER USER;

COMMIT;
