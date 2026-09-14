"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const {
  REPORT_CARD_MODULE_KEY,
  reconcileCanonicalReportCardGrants,
} = require("./reportCardRbacCanonical");

test("report-card-s1-admin-school-stale-read-gains-submit", async () => {
  const store = createFunctionalRbacMemoryStore();
  await store.upsertGrant({
    roleKey: "SCHOOL_ADMIN",
    scopeType: "global",
    moduleKey: REPORT_CARD_MODULE_KEY,
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "stale",
  });
  const first = await reconcileCanonicalReportCardGrants(store);
  assert.equal(first, 1);
  const second = await reconcileCanonicalReportCardGrants(store);
  assert.equal(second, 0);
  const grants = await store.listGrantsForScope({
    roleKey: "SCHOOL_ADMIN",
    scopeType: "global",
    countryId: null,
    schoolId: null,
  });
  const bulletins = grants.find((row) => row.moduleKey === REPORT_CARD_MODULE_KEY);
  assert.equal(bulletins.canCreate, true);
  assert.equal(bulletins.canRead, true);
  assert.equal(bulletins.canUpdate, true);
  assert.equal(bulletins.canDelete, false);
});

test("report-card-s1-secretary-not-widened", async () => {
  const store = createFunctionalRbacMemoryStore();
  await store.upsertGrant({
    roleKey: "SECRETARY",
    scopeType: "global",
    moduleKey: REPORT_CARD_MODULE_KEY,
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "stale",
  });
  await reconcileCanonicalReportCardGrants(store);
  const grants = await store.listGrantsForScope({
    roleKey: "SECRETARY",
    scopeType: "global",
    countryId: null,
    schoolId: null,
  });
  const bulletins = grants.find((row) => row.moduleKey === REPORT_CARD_MODULE_KEY);
  assert.equal(bulletins.canCreate, false);
  assert.equal(bulletins.canUpdate, false);
});
