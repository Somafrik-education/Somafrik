"use strict";

/**
 * Admin School : CREATE+READ+UPDATE sur Bulletins (demande de modèle + approbation).
 * UNION idempotente — n'élargit jamais Secrétaire / Parent / Élève.
 */

const { orCrud, crudEquals } = require("./planningRbacCanonical");

const REPORT_CARD_MODULE_KEY = "report_cards";
const REPORT_CARD_RBAC_UPDATED_BY = "bootstrap-report-card-s1-canonical";

const CANONICAL_REPORT_CARD_ROLE_GRANTS = Object.freeze({
  SCHOOL_ADMIN: Object.freeze({
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  }),
});

const REPORT_CARD_EXCLUDED_ROLE_KEYS = Object.freeze(["PARENT", "SECRETARY", "STUDENT"]);

async function reconcileCanonicalReportCardGrants(store) {
  let changed = 0;
  for (const [roleKey, canonical] of Object.entries(CANONICAL_REPORT_CARD_ROLE_GRANTS)) {
    if (REPORT_CARD_EXCLUDED_ROLE_KEYS.includes(roleKey)) {
      throw new Error(`grant interdit pour ${roleKey}`);
    }
    const existing = await store.listGrantsForScope({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    const current = existing.find((row) => row.moduleKey === REPORT_CARD_MODULE_KEY);
    const next = current ? orCrud(current, canonical) : { ...canonical };
    if (current && crudEquals(current, next)) continue;
    await store.upsertGrant({
      roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: REPORT_CARD_MODULE_KEY,
      ...next,
      updatedBy: REPORT_CARD_RBAC_UPDATED_BY,
    });
    changed += 1;
  }
  return changed;
}

module.exports = {
  REPORT_CARD_MODULE_KEY,
  CANONICAL_REPORT_CARD_ROLE_GRANTS,
  REPORT_CARD_EXCLUDED_ROLE_KEYS,
  REPORT_CARD_RBAC_UPDATED_BY,
  reconcileCanonicalReportCardGrants,
};
