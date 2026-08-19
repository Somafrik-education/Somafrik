"use strict";

/**
 * Grants canoniques Salles + Remplacements (matrice produit Planning V2).
 * UNION idempotente — n'insère jamais Parent / Secrétaire / Élève.
 */

const { orCrud, crudEquals } = require("./planningRbacCanonical");

const ROOMS_MODULE_KEY = "rooms";
const REPLACEMENTS_MODULE_KEY = "replacements";

const CANONICAL_ROOMS_ROLE_GRANTS = Object.freeze({
  SCHOOL_ADMIN: Object.freeze({ canCreate: true, canRead: true, canUpdate: true, canDelete: true }),
  PREFET_ETUDES: Object.freeze({ canCreate: true, canRead: true, canUpdate: true, canDelete: true }),
  TEACHER: Object.freeze({ canCreate: false, canRead: true, canUpdate: false, canDelete: false }),
});

const CANONICAL_REPLACEMENTS_ROLE_GRANTS = Object.freeze({
  SCHOOL_ADMIN: Object.freeze({ canCreate: true, canRead: true, canUpdate: true, canDelete: true }),
  PREFET_ETUDES: Object.freeze({ canCreate: true, canRead: true, canUpdate: true, canDelete: true }),
  TEACHER: Object.freeze({ canCreate: false, canRead: true, canUpdate: false, canDelete: false }),
});

const PLANNING_RESOURCE_EXCLUDED_ROLE_KEYS = Object.freeze(["PARENT", "SECRETARY", "STUDENT"]);

async function reconcileModuleGrants(store, moduleKey, grantsByRole, updatedBy) {
  let changed = 0;
  for (const [roleKey, canonical] of Object.entries(grantsByRole)) {
    const existing = await store.listGrantsForScope({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    const current = existing.find((row) => row.moduleKey === moduleKey);
    const next = current ? orCrud(current, canonical) : { ...canonical };
    if (current && crudEquals(current, next)) continue;
    await store.upsertGrant({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey,
      ...next,
      updatedBy,
    });
    changed += 1;
  }
  return changed;
}

async function reconcileCanonicalRoomsGrants(store) {
  return reconcileModuleGrants(store, ROOMS_MODULE_KEY, CANONICAL_ROOMS_ROLE_GRANTS, "bootstrap-rooms-canonical");
}

async function reconcileCanonicalReplacementsGrants(store) {
  return reconcileModuleGrants(
    store,
    REPLACEMENTS_MODULE_KEY,
    CANONICAL_REPLACEMENTS_ROLE_GRANTS,
    "bootstrap-replacements-canonical",
  );
}

async function reconcileCanonicalRoomsReplacementsGrants(store) {
  const rooms = await reconcileCanonicalRoomsGrants(store);
  const replacements = await reconcileCanonicalReplacementsGrants(store);
  return { rooms, replacements };
}

module.exports = {
  ROOMS_MODULE_KEY,
  REPLACEMENTS_MODULE_KEY,
  CANONICAL_ROOMS_ROLE_GRANTS,
  CANONICAL_REPLACEMENTS_ROLE_GRANTS,
  PLANNING_RESOURCE_EXCLUDED_ROLE_KEYS,
  reconcileCanonicalRoomsGrants,
  reconcileCanonicalReplacementsGrants,
  reconcileCanonicalRoomsReplacementsGrants,
};
