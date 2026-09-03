-- Vérification APRÈS réconciliation P0 RBAC.
-- Lecture seule. Échec attendu si un seuil n'est pas atteint.

DO $$
DECLARE
  teacher_tokens INTEGER;
  teacher_modules INTEGER;
  prefet_tokens INTEGER;
  director_tokens INTEGER;
  missing_roles INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_roles
  FROM (
    VALUES
      ('Proviseur'),
      ('Préfet des études'),
      ('Directeur'),
      ('Secrétaire'),
      ('Enseignant'),
      ('Parent'),
      ('Élève / Étudiant'),
      ('Comptable'),
      ('Surveillant'),
      ('Super Administrateur Somafrik'),
      ('Admin Pays'),
      ('Admin School')
  ) required(role_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM establishment_roles er
    WHERE lower(er.role_name) = lower(required.role_name)
  );
  IF missing_roles > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: % rôle(s) système manquant(s)', missing_roles;
  END IF;

  SELECT COUNT(*) INTO teacher_tokens
  FROM establishment_roles er
  JOIN establishment_role_permissions erp ON erp.role_id = er.id
  WHERE er.role_name = 'Enseignant';
  IF teacher_tokens < 28 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: Enseignant tokens=% (attendu >= 28)', teacher_tokens;
  END IF;

  SELECT COUNT(*) INTO teacher_modules
  FROM role_module_permissions rmp
  WHERE rmp.status = 'active'
    AND rmp.scope_type = 'global'
    AND upper(rmp.role_key) = 'TEACHER'
    AND rmp.country_id IS NULL
    AND rmp.school_id IS NULL;
  IF teacher_modules < 17 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: TEACHER modules=% (attendu >= 17)', teacher_modules;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM establishment_roles er
    JOIN establishment_role_permissions erp ON erp.role_id = er.id
    WHERE er.role_name = 'Enseignant' AND erp.permission = 'Élèves:READ'
  ) THEN
    RAISE EXCEPTION 'VERIFY_FAIL: Enseignant sans Élèves:READ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM establishment_roles er
    JOIN establishment_role_permissions erp ON erp.role_id = er.id
    WHERE er.role_name = 'Enseignant' AND erp.permission = 'Messages:READ'
  ) THEN
    RAISE EXCEPTION 'VERIFY_FAIL: Enseignant sans Messages:READ';
  END IF;

  SELECT COUNT(*) INTO prefet_tokens
  FROM establishment_roles er
  JOIN establishment_role_permissions erp ON erp.role_id = er.id
  WHERE er.role_name = 'Préfet des études';
  IF prefet_tokens < 74 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: Préfet tokens=% (attendu >= 74)', prefet_tokens;
  END IF;

  SELECT COUNT(*) INTO director_tokens
  FROM establishment_roles er
  JOIN establishment_role_permissions erp ON erp.role_id = er.id
  WHERE er.role_name = 'Directeur';
  IF director_tokens < 68 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: Directeur tokens=% (attendu >= 68)', director_tokens;
  END IF;
END $$;

SELECT er.role_name, COUNT(erp.permission)::int AS permission_count
FROM establishment_roles er
LEFT JOIN establishment_role_permissions erp ON erp.role_id = er.id
WHERE er.role_name IN (
  'Proviseur', 'Préfet des études', 'Directeur', 'Secrétaire', 'Enseignant',
  'Parent', 'Élève / Étudiant', 'Comptable', 'Surveillant',
  'Super Administrateur Somafrik', 'Admin Pays', 'Admin School'
)
GROUP BY er.role_name
ORDER BY er.role_name;

SELECT rmp.role_key, COUNT(*)::int AS module_count
FROM role_module_permissions rmp
WHERE rmp.status = 'active'
  AND rmp.scope_type = 'global'
  AND rmp.country_id IS NULL
  AND rmp.school_id IS NULL
  AND upper(rmp.role_key) IN (
    'PROVISEUR', 'PREFET_ETUDES', 'PRINCIPAL', 'SECRETARY', 'TEACHER',
    'PARENT', 'STUDENT', 'ACCOUNTANT', 'SUPERVISOR',
    'SUPER_ADMIN', 'COUNTRY_ADMIN', 'SCHOOL_ADMIN'
  )
GROUP BY rmp.role_key
ORDER BY rmp.role_key;
