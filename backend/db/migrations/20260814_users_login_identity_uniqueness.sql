-- Unicité identité de connexion users (email / téléphone) — migration contrôlée.
-- Idempotente. Appliquée aussi au boot via PostgresRepository.ensureUsersLoginIdentityConstraints.
-- Interdit : suppression automatique des comptes en doublon.

DO $$
DECLARE
  school_email_dup integer := 0;
  school_phone_dup integer := 0;
  platform_email_dup integer := 0;
  platform_phone_dup integer := 0;
BEGIN
  SELECT COUNT(*)::int INTO school_email_dup
  FROM (
    SELECT school_id, lower(trim(email))
    FROM users
    WHERE school_id IS NOT NULL AND email IS NOT NULL AND trim(email) <> ''
      AND COALESCE(status, 'active') NOT IN ('deleted', 'archived')
    GROUP BY school_id, lower(trim(email))
    HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(*)::int INTO school_phone_dup
  FROM (
    SELECT school_id, lower(trim(phone))
    FROM users
    WHERE school_id IS NOT NULL AND phone IS NOT NULL AND trim(phone) <> ''
      AND COALESCE(status, 'active') NOT IN ('deleted', 'archived')
    GROUP BY school_id, lower(trim(phone))
    HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(*)::int INTO platform_email_dup
  FROM (
    SELECT lower(trim(email))
    FROM users
    WHERE school_id IS NULL AND email IS NOT NULL AND trim(email) <> ''
      AND COALESCE(status, 'active') NOT IN ('deleted', 'archived')
    GROUP BY lower(trim(email))
    HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(*)::int INTO platform_phone_dup
  FROM (
    SELECT lower(trim(phone))
    FROM users
    WHERE school_id IS NULL AND phone IS NOT NULL AND trim(phone) <> ''
      AND COALESCE(status, 'active') NOT IN ('deleted', 'archived')
    GROUP BY lower(trim(phone))
    HAVING COUNT(*) > 1
  ) d;

  IF school_email_dup + school_phone_dup + platform_email_dup + platform_phone_dup > 0 THEN
    RAISE EXCEPTION
      'Users : % groupe(s) en doublon (identité de connexion email/téléphone). Résolution explicite requise avant création des index d''unicité. Aucune suppression automatique n''est effectuée.',
      school_email_dup + school_phone_dup + platform_email_dup + platform_phone_dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_email
  ON users (school_id, lower(trim(email)))
  WHERE school_id IS NOT NULL AND email IS NOT NULL AND trim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_phone
  ON users (school_id, lower(trim(phone)))
  WHERE school_id IS NOT NULL AND phone IS NOT NULL AND trim(phone) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_platform_email
  ON users (lower(trim(email)))
  WHERE school_id IS NULL AND email IS NOT NULL AND trim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_platform_phone
  ON users (lower(trim(phone)))
  WHERE school_id IS NULL AND phone IS NOT NULL AND trim(phone) <> '';
