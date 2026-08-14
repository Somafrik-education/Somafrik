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
