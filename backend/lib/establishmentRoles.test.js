"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertNoLegacyUserRolesWrite,
  stripLegacyUserRoles,
  sanitizePermissionList,
} = require("./establishmentRolesManagement");

test("assertNoLegacyUserRolesWrite rejette userRoles y compris null/[]", () => {
  for (const payload of [{ userRoles: ["Secrétaire"] }, { userRoles: [] }, { userRoles: null }]) {
    assert.throws(() => assertNoLegacyUserRolesWrite(payload));
  }
  assert.doesNotThrow(() => assertNoLegacyUserRolesWrite({ periods: [] }));
});

test("stripLegacyUserRoles retire la clé interdite", () => {
  const next = stripLegacyUserRoles({ userRoles: ["x"], periods: [] });
  assert.equal("userRoles" in next, false);
  assert.ok(Array.isArray(next.periods));
});

test("sanitizePermissionList rejette ALL_PRIVILEGES", () => {
  assert.throws(() => sanitizePermissionList(["ALL_PRIVILEGES", "Classes:READ"]));
});

test("getPermissionsMap inclut les rôles actifs sans permission", async () => {
  const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
  const store = createEstablishmentRolesMemoryStore({ roles: [] });
  await store.insertRole({
    roleCode: "lot2_vide",
    roleName: "Lot2 Vide",
    permissions: [],
    delegationPermissions: [],
  });
  const map = await store.getPermissionsMap();
  assert.ok(Object.prototype.hasOwnProperty.call(map, "Lot2 Vide"));
  assert.deepEqual(map["Lot2 Vide"], []);
});
