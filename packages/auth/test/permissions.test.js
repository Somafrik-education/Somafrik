import assert from "node:assert/strict";
import test from "node:test";

import { can, createAuthPrincipal } from "../src/index.js";

function principalWith(permissions, overrides = {}) {
  return createAuthPrincipal({
    userId: "user-001",
    role: "teacher",
    tenantScope: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    permissions,
    ...overrides,
  });
}

test("returns true only for an exact permission match", () => {
  const principal = principalWith(["notes:write", "presences:read"]);

  assert.equal(can(principal, "notes:write"), true);
  assert.equal(can(principal, "presences:read"), true);
  assert.equal(can(principal, "notes:read"), false);
});

test("is case-sensitive and never normalizes permission tokens", () => {
  const principal = principalWith(["Notes:Write"]);

  assert.equal(can(principal, "Notes:Write"), true);
  assert.equal(can(principal, "notes:write"), false);
  assert.equal(can(principal, "NOTES:WRITE"), false);
});

test("does not grant the legacy dashboard fallback", () => {
  const principal = principalWith([]);

  assert.equal(can(principal, "Voir tableau de bord"), false);
});

test("does not grant implicit rights to super_admin", () => {
  const principal = principalWith([], {
    role: "super_admin",
    tenantScope: { kind: "platform" },
  });

  assert.equal(can(principal, "ALL_PRIVILEGES"), false);
  assert.equal(can(principal, "students:delete"), false);
});

test("never treats privilege markers as wildcards", () => {
  const starPrincipal = principalWith(["*"]);
  const allPrivilegesPrincipal = principalWith(["ALL_PRIVILEGES"]);
  const countryPrivilegesPrincipal = principalWith(["COUNTRY_PRIVILEGES"]);

  assert.equal(can(starPrincipal, "students:read"), false);
  assert.equal(can(starPrincipal, "*"), true);

  assert.equal(can(allPrivilegesPrincipal, "students:read"), false);
  assert.equal(can(allPrivilegesPrincipal, "ALL_PRIVILEGES"), true);

  assert.equal(can(countryPrivilegesPrincipal, "schools:read"), false);
  assert.equal(can(countryPrivilegesPrincipal, "COUNTRY_PRIVILEGES"), true);
});

test("fails closed for absent, empty, or invalid requested permissions", () => {
  const principal = principalWith(["notes:write"]);

  assert.equal(can(principal, undefined), false);
  assert.equal(can(principal, null), false);
  assert.equal(can(principal, ""), false);
  assert.equal(can(principal, "   "), false);
  assert.equal(can(principal, 1), false);
});

test("fails closed for absent or malformed principals without throwing", () => {
  assert.equal(can(null, "notes:write"), false);
  assert.equal(can(undefined, "notes:write"), false);
  assert.equal(can("teacher", "notes:write"), false);
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "unknown_role",
        tenantScope: { kind: "platform" },
        permissions: ["notes:write"],
      },
      "notes:write",
    ),
    false,
  );
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "teacher",
        tenantScope: { kind: "country" },
        permissions: ["notes:write"],
      },
      "notes:write",
    ),
    false,
  );
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "teacher",
        tenantScope: {
          kind: "school",
          countryCode: "CD",
          schoolCode: "CD-2026-0001",
        },
        permissions: "notes:write",
      },
      "notes:write",
    ),
    false,
  );
  assert.equal(
    can(
      {
        userId: "   ",
        role: "teacher",
        tenantScope: { kind: "platform" },
        permissions: ["notes:write"],
      },
      "notes:write",
    ),
    false,
  );
});
