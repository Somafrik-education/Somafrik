-- Inventaire AVANT réconciliation P0 RBAC.
-- Lecture seule. Ne modifie aucune donnée.

-- 1. Jetons establishment_role_permissions par rôle système
SELECT
  er.role_name,
  er.role_code,
  er.status,
  COUNT(erp.permission)::int AS permission_count
FROM establishment_roles er
LEFT JOIN establishment_role_permissions erp ON erp.role_id = er.id
WHERE er.role_name IN (
  'Proviseur',
  'Préfet des études',
  'Directeur',
  'Secrétaire',
  'Enseignant',
  'Parent',
  'Élève / Étudiant',
  'Comptable',
  'Surveillant',
  'Super Administrateur Somafrik',
  'Admin Pays',
  'Admin School'
)
GROUP BY er.role_name, er.role_code, er.status
ORDER BY er.role_name;

-- 2. Modules fonctionnels globaux par rôle
SELECT
  rmp.role_key,
  COUNT(*)::int AS module_count,
  COUNT(*) FILTER (WHERE rmp.can_read)::int AS read_count,
  COUNT(*) FILTER (WHERE rmp.can_create)::int AS create_count
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

-- 3. Jetons historiques encore seuls (sans jeton canonique)
SELECT er.role_name, erp.permission
FROM establishment_roles er
JOIN establishment_role_permissions erp ON erp.role_id = er.id
WHERE er.role_name = 'Enseignant'
  AND erp.permission IN (
    'Voir élèves', 'Modifier notes', 'Créer notes', 'Faire appel', 'Messages parents'
  )
ORDER BY erp.permission;

-- 4. Snapshot utilisateurs dont les droits effectifs changeront
SELECT ur.role_key, COUNT(DISTINCT ur.user_id)::int AS user_count
FROM user_roles ur
WHERE ur.status = 'active'
  AND upper(ur.role_key) IN (
    'PROVISEUR', 'PREFET_ETUDES', 'PRINCIPAL', 'SECRETARY', 'TEACHER',
    'PARENT', 'STUDENT', 'ACCOUNTANT', 'SUPERVISOR'
  )
GROUP BY ur.role_key
ORDER BY ur.role_key;
