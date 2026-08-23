"use strict";

/**
 * RETIRÉ (J2 / P0-3) — ne plus exécuter.
 *
 * Ancien comportement (historique Git uniquement) :
 *   - recharge un état Contacts / snapshot legacy ;
 *   - écrit `backoffice_state` ;
 *   - DELETE potentiellement attendance, grades, enrollments,
 *     students, teacher_assignments, teachers, users.
 *
 * PostgreSQL canonique est la source de vérité.
 * Pas de réécriture fonctionnelle legacy.
 */

const REMOVAL_MESSAGE =
  "INTERDIT : sync-contacts-registry / db:sync-contacts est retiré. " +
  "PostgreSQL canonique est la source de vérité. " +
  "Ce script écrivait backoffice_state et DELETE des tables métier.";

function refuseSyncContactsRegistry() {
  const error = new Error(REMOVAL_MESSAGE);
  error.code = "SYNC_CONTACTS_REMOVED";
  return error;
}

function assertSyncContactsRegistryRemoved() {
  throw refuseSyncContactsRegistry();
}

if (require.main === module) {
  console.error(REMOVAL_MESSAGE);
  process.exit(1);
}

module.exports = {
  REMOVAL_MESSAGE,
  refuseSyncContactsRegistry,
  assertSyncContactsRegistryRemoved,
};
