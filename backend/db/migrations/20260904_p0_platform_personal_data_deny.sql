-- P0-2 — retrait des permissions personnelles établissement des rôles plateforme.
-- Idempotente. Défense en profondeur : le deny serveur reste l'autorité.
-- INTERDIT : exécuter sur Somafrik-prod depuis Cursor. GO CTO obligatoire.
--
-- Ne pas réintroduire via 20260903_p0_system_roles_rbac_reconciliation.sql :
-- le catalogue seed (data.js) ne contient plus ces jetons pour SUPER_ADMIN /
-- COUNTRY_ADMIN. Cette migration nettoie les bases déjà réconciliées.

DO $$
BEGIN
  IF to_regclass('public.establishment_roles') IS NULL THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE _p0_platform_personal_modules (
    module_key TEXT PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO _p0_platform_personal_modules (module_key) VALUES
    ('students'),
    ('teachers'),
    ('assignments'),
    ('contacts'),
    ('relations'),
    ('attendance'),
    ('grades'),
    ('report_cards'),
    ('payments'),
    ('unpaid'),
    ('messages'),
    ('documents'),
    ('exams');

  CREATE TEMP TABLE _p0_platform_role_match (
    role_id UUID PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO _p0_platform_role_match (role_id)
  SELECT er.id
  FROM establishment_roles er
  WHERE upper(er.role_code) IN ('SUPER_ADMIN', 'COUNTRY_ADMIN')
     OR lower(er.role_name) IN (
       'super administrateur somafrik',
       'super administrateur okafric',
       'admin pays'
     )
  ON CONFLICT DO NOTHING;

  IF to_regclass('public.establishment_role_permissions') IS NOT NULL THEN
    DELETE FROM establishment_role_permissions erp
    USING _p0_platform_role_match prm
    WHERE erp.role_id = prm.role_id
      AND (
        erp.permission LIKE 'Élèves:%'
        OR erp.permission LIKE 'Enseignants:%'
        OR erp.permission LIKE 'Affectations:%'
        OR erp.permission LIKE 'Contacts:%'
        OR erp.permission LIKE 'Relations:%'
        OR erp.permission LIKE 'Présences:%'
        OR erp.permission LIKE 'Notes:%'
        OR erp.permission LIKE 'Bulletins:%'
        OR erp.permission LIKE 'Paiements:%'
        OR erp.permission LIKE 'Impayés:%'
        OR erp.permission LIKE 'Messages:%'
        OR erp.permission LIKE 'Documents:%'
        OR erp.permission LIKE 'Examens:%'
        OR erp.permission IN (
          'Voir élèves', 'Gérer élèves',
          'Voir enseignants', 'Ajouter enseignants', 'Gérer enseignants',
          'Voir notes', 'Créer notes', 'Modifier notes',
          'Voir présences', 'Modifier présences', 'Faire appel', 'Gérer appels',
          'Voir paiements', 'Gérer paiements',
          'Messages parents', 'Messages école', 'Gérer messages',
          'Voir bulletins', 'Valider bulletins',
          'Voir documents',
          'Voir examens', 'Organiser examens', 'Valider examens',
          'Voir enfant', 'Gérer annonces', 'Publier communications'
        )
      );
  END IF;

  IF to_regclass('public.establishment_role_delegation_permissions') IS NOT NULL THEN
    DELETE FROM establishment_role_delegation_permissions edp
    USING _p0_platform_role_match prm
    WHERE edp.role_id = prm.role_id
      AND (
        edp.permission LIKE 'Élèves:%'
        OR edp.permission LIKE 'Enseignants:%'
        OR edp.permission LIKE 'Affectations:%'
        OR edp.permission LIKE 'Contacts:%'
        OR edp.permission LIKE 'Relations:%'
        OR edp.permission LIKE 'Présences:%'
        OR edp.permission LIKE 'Notes:%'
        OR edp.permission LIKE 'Bulletins:%'
        OR edp.permission LIKE 'Paiements:%'
        OR edp.permission LIKE 'Impayés:%'
        OR edp.permission LIKE 'Messages:%'
        OR edp.permission LIKE 'Documents:%'
        OR edp.permission LIKE 'Examens:%'
        OR edp.permission IN (
          'Voir élèves', 'Gérer élèves',
          'Voir enseignants', 'Ajouter enseignants', 'Gérer enseignants',
          'Voir notes', 'Créer notes', 'Modifier notes',
          'Voir présences', 'Modifier présences', 'Faire appel', 'Gérer appels',
          'Voir paiements', 'Gérer paiements',
          'Messages parents', 'Messages école', 'Gérer messages',
          'Voir bulletins', 'Valider bulletins',
          'Voir documents',
          'Voir examens', 'Organiser examens', 'Valider examens',
          'Voir enfant', 'Gérer annonces', 'Publier communications'
        )
      );
  END IF;

  IF to_regclass('public.role_module_permissions') IS NOT NULL THEN
    UPDATE role_module_permissions rmp
    SET
      can_create = FALSE,
      can_read = FALSE,
      can_update = FALSE,
      can_delete = FALSE,
      updated_by = 'p0-platform-personal-data-deny-20260904',
      updated_at = NOW()
    WHERE rmp.status = 'active'
      AND upper(rmp.role_key) IN ('SUPER_ADMIN', 'COUNTRY_ADMIN')
      AND rmp.module_key IN (SELECT module_key FROM _p0_platform_personal_modules);
  END IF;
END $$;
