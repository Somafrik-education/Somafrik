"use strict";

/**
 * NFC-ROLES-ACCESS-01 — compatibilité RBAC à exécuter UNE FOIS après l'ensemencement du
 * catalogue et des anciennes permissions, AVANT l'ouverture HTTP.
 *
 * Un marqueur transactionnel PostgreSQL empêche toute remise à zéro des choix du Superadmin :
 * un droit roll_call refusé/archivé n'est jamais réaccordé au redémarrage. Toute réexécution
 * est un no-op. Pas de nouveaux rôles ni de délégation School Admin.
 */
const LEGACY_ROLE_KEYS = Object.freeze([
  "TEACHER", "SCHOOL_ADMIN", "SECRETARY", "PROVISEUR", "PRINCIPAL", "PREFET_ETUDES",
]);

async function migrateRollCallGrantsOnce(repo) {
  if (typeof repo?.query !== "function") throw new Error("PostgreSQL obligatoire pour la migration RBAC d'appel.");
  // Un seul statement transactionnel : advisory lock, transfert et marqueur atomiques.
  // Ne pas utiliser ON CONFLICT pour restaurer les droits précédemment refusés.
  await repo.query(`
    DO $roll_call_grants$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('nfc-roles-access-01'), hashtext('rbac-once'));
      CREATE TABLE IF NOT EXISTS rbac_one_time_migrations (
        migration_key text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT NOW()
      );
      IF NOT EXISTS (
        SELECT 1 FROM rbac_one_time_migrations
        WHERE migration_key = 'nfc-roles-access-01'
      ) THEN
        INSERT INTO role_module_permissions (
          role_key, scope_type, country_id, school_id, module_key,
          can_create, can_read, can_update, can_delete, status, updated_by
        )
        SELECT att.role_key, att.scope_type, att.country_id, att.school_id,
               'roll_call', (att.can_create OR att.can_update), FALSE, FALSE, FALSE,
               'active', 'bootstrap-nfc-roles-access-01'
        FROM role_module_permissions att
        WHERE att.module_key = 'attendance'
          AND att.status = 'active'
          AND upper(att.role_key) = ANY(ARRAY['TEACHER','SCHOOL_ADMIN','SECRETARY','PROVISEUR','PRINCIPAL','PREFET_ETUDES']::text[])
          AND NOT EXISTS (
            SELECT 1 FROM role_module_permissions prior
            WHERE prior.module_key = 'roll_call'
              AND upper(prior.role_key) = upper(att.role_key)
              AND prior.scope_type = att.scope_type
              AND prior.country_id IS NOT DISTINCT FROM att.country_id
              AND prior.school_id IS NOT DISTINCT FROM att.school_id
          );
        INSERT INTO rbac_one_time_migrations (migration_key) VALUES ('nfc-roles-access-01');
      END IF;
    END
    $roll_call_grants$;
  `);
}

module.exports = { LEGACY_ROLE_KEYS, migrateRollCallGrantsOnce };
