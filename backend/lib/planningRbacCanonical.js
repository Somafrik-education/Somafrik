"use strict";

/**
 * Grants Planning de cours canoniques (matrice produit).
 * Après le premier bootstrap, l'autorité est role_module_permissions PostgreSQL.
 * Un rôle établissement déjà présent (catalogue / grants périmés) doit recevoir
 * ces flags par réconciliation idempotente — sans recréer le rôle.
 *
 * Parent / Secrétaire : aucun élargissement.
 */

const PLANNING_MODULE_KEY = "planning";

const CANONICAL_PLANNING_ROLE_GRANTS = Object.freeze({
  SCHOOL_ADMIN: Object.freeze({
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
  }),
  PREFET_ETUDES: Object.freeze({
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
  }),
  TEACHER: Object.freeze({
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
  }),
});

const PLANNING_EXCLUDED_ROLE_KEYS = Object.freeze(["PARENT", "SECRETARY", "STUDENT"]);

function orCrud(left = {}, right = {}) {
  return {
    canCreate: Boolean(left.canCreate || right.canCreate),
    canRead: Boolean(left.canRead || right.canRead),
    canUpdate: Boolean(left.canUpdate || right.canUpdate),
    canDelete: Boolean(left.canDelete || right.canDelete),
  };
}

function crudEquals(left, right) {
  return (
    Boolean(left?.canCreate) === Boolean(right?.canCreate) &&
    Boolean(left?.canRead) === Boolean(right?.canRead) &&
    Boolean(left?.canUpdate) === Boolean(right?.canUpdate) &&
    Boolean(left?.canDelete) === Boolean(right?.canDelete)
  );
}

/**
 * UNION des flags canoniques Planning sur les grants globaux existants.
 * N'insère jamais de grant pour Parent / Secrétaire / Élève.
 * Idempotent : no-op si le grant global couvre déjà le canonique.
 */
async function reconcileCanonicalPlanningGrants(store) {
  let changed = 0;
  for (const [roleKey, canonical] of Object.entries(CANONICAL_PLANNING_ROLE_GRANTS)) {
    const existing = await store.listGrantsForScope({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    const current = existing.find((row) => row.moduleKey === PLANNING_MODULE_KEY);
    const next = current ? orCrud(current, canonical) : { ...canonical };
    if (current && crudEquals(current, next)) continue;
    await store.upsertGrant({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: PLANNING_MODULE_KEY,
      ...next,
      updatedBy: "bootstrap-planning-canonical",
    });
    changed += 1;
  }
  return changed;
}

module.exports = {
  PLANNING_MODULE_KEY,
  CANONICAL_PLANNING_ROLE_GRANTS,
  PLANNING_EXCLUDED_ROLE_KEYS,
  orCrud,
  crudEquals,
  reconcileCanonicalPlanningGrants,
};
