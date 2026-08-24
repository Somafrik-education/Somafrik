"use strict";

/**
 * J3 — trous live role_module_permissions qui cassent une action métier
 * pourtant prévue par le contrat (notes enseignant, affectation préfet).
 *
 * UNION idempotente des flags globaux. Le Comptable n'obtient jamais
 * Élèves:READ ici : le picker Finance doit utiliser une projection minimale
 * dédiée plutôt que l'annuaire élèves général.
 * Après bootstrap, PostgreSQL reste l'autorité.
 */

const { orCrud, crudEquals } = require("./planningRbacCanonical");

const CRITICAL_PARITY_UPDATED_BY = "bootstrap-j3-critical-parity";

const CANONICAL_CRITICAL_PARITY_GRANTS = Object.freeze([
  Object.freeze({
    roleKey: "TEACHER",
    moduleKey: "assignments",
    crud: Object.freeze({
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    }),
  }),
  Object.freeze({
    roleKey: "PREFET_ETUDES",
    moduleKey: "assignments",
    crud: Object.freeze({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    }),
  }),
]);

const CRITICAL_PARITY_EXCLUDED_ROLE_KEYS = Object.freeze(["ACCOUNTANT", "PARENT", "STUDENT"]);

async function reconcileCanonicalCriticalParityGrants(store) {
  let changed = 0;
  for (const grant of CANONICAL_CRITICAL_PARITY_GRANTS) {
    if (CRITICAL_PARITY_EXCLUDED_ROLE_KEYS.includes(grant.roleKey)) {
      throw new Error(`grant interdit pour ${grant.roleKey}`);
    }
    const existing = await store.listGrantsForScope({
      roleKey: grant.roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    const current = existing.find((row) => row.moduleKey === grant.moduleKey);
    const next = current ? orCrud(current, grant.crud) : { ...grant.crud };
    if (current && crudEquals(current, next)) continue;
    await store.upsertGrant({
      roleKey: grant.roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: grant.moduleKey,
      ...next,
      updatedBy: CRITICAL_PARITY_UPDATED_BY,
    });
    changed += 1;
  }
  return changed;
}

module.exports = {
  CANONICAL_CRITICAL_PARITY_GRANTS,
  CRITICAL_PARITY_EXCLUDED_ROLE_KEYS,
  CRITICAL_PARITY_UPDATED_BY,
  reconcileCanonicalCriticalParityGrants,
};
