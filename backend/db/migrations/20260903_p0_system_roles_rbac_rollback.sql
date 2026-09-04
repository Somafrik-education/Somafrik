-- Rollback P0 RBAC — additive uniquement.
-- Ne restaure PAS les flags OR-és sans snapshot d'inventaire.
-- Procédure officielle : restaurer le backup PostgreSQL pris avant apply.
--
-- Ce script ne retire que les INSERT tagués par l'acteur de réconciliation
-- (grants version=1 créés par la migration). Les jetons establishment_*
-- ajoutés n'ont pas d'acteur : les retirer uniquement depuis le snapshot
-- d'inventaire, jamais à l'aveugle.

BEGIN;

-- 1. Grants nouvellement insérés par cette réconciliation (version 1, acteur P0)
DELETE FROM role_module_permissions
WHERE updated_by = 'bootstrap-system-roles-reconciliation-p0'
  AND created_by = 'bootstrap-system-roles-reconciliation-p0'
  AND version = 1
  AND scope_type = 'global'
  AND country_id IS NULL
  AND school_id IS NULL;

-- 2. Grants OR-és : restauration impossible sans snapshot.
--    Restaurer le backup. Ne pas remettre les flags à false ici.

-- 3. Ne jamais DELETE FROM establishment_role_permissions sans liste
--    exacte du delta inventaire. Un jeton préexistant homonyme
--    (alias historique) doit être conservé.

COMMIT;
