import assert from "node:assert/strict";
import test from "node:test";

import { can, createAuthPrincipal, isCanonicalRole } from "../src/index.js";

function principalWith(permissions, overrides = {}) {
  return createAuthPrincipal({
    userId: "user-001",
    role: "school_admin",
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
  const principal = principalWith(["users:update", "schools:read"]);

  assert.equal(can(principal, "users:update"), true);
  assert.equal(can(principal, "schools:read"), true);
  assert.equal(can(principal, "users:read"), false);
});

test("is case-sensitive and never normalizes permission tokens", () => {
  assert.throws(
    () => principalWith(["Notes:Write"]),
    (error) =>
      error &&
      error.name === "AuthPrincipalValidationError" &&
      error.code === "AUTH_PRINCIPAL_INVALID",
  );

  const principal = principalWith(["users:update"]);
  assert.equal(can(principal, "users:update"), true);
  assert.equal(can(principal, "Notes:Write"), false);
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
  assert.equal(can(principal, "users:disable"), false);
});

test("never treats privilege markers as wildcards", () => {
  assert.throws(() => principalWith(["*"]), /canonical permission token/);
  assert.throws(() => principalWith(["ALL_PRIVILEGES"]), /canonical permission token/);
  assert.throws(() => principalWith(["COUNTRY_PRIVILEGES"]), /canonical permission token/);

  const principal = principalWith(["users:update"]);
  assert.equal(can(principal, "*"), false);
  assert.equal(can(principal, "notes:*"), false);
  assert.equal(can(principal, "*:read"), false);
  assert.equal(can(principal, "ALL_PRIVILEGES"), false);
  assert.equal(can(principal, "COUNTRY_PRIVILEGES"), false);
  assert.equal(can(principal, "users:update"), true);
});

test("fails closed for absent, empty, or invalid requested permissions", () => {
  const principal = principalWith(["users:update"]);

  assert.equal(can(principal, undefined), false);
  assert.equal(can(principal, null), false);
  assert.equal(can(principal, ""), false);
  assert.equal(can(principal, "   "), false);
  assert.equal(can(principal, 1), false);
});

test("fails closed for absent or malformed principals without throwing", () => {
  assert.equal(can(null, "users:update"), false);
  assert.equal(can(undefined, "users:update"), false);
  assert.equal(can("teacher", "users:update"), false);
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "unknown_role",
        tenantScope: { kind: "platform" },
        permissions: ["users:update"],
      },
      "users:update",
    ),
    false,
  );
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "teacher",
        tenantScope: { kind: "country" },
        permissions: ["users:update"],
      },
      "users:update",
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
        permissions: "users:update",
      },
      "users:update",
    ),
    false,
  );
  assert.equal(
    can(
      {
        userId: "   ",
        role: "teacher",
        tenantScope: { kind: "platform" },
        permissions: ["users:update"],
      },
      "users:update",
    ),
    false,
  );
});

test("rejects a principal whose four fields are only inherited", () => {
  const forged = Object.create({
    userId: "attacker",
    role: "super_admin",
    tenantScope: { kind: "platform" },
    permissions: ["users:disable"],
  });

  assert.equal(can(forged, "users:disable"), false);
});

test("rejects a principal that carries an extra own field", () => {
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "teacher",
        tenantScope: { kind: "platform" },
        permissions: ["users:update"],
        sessionId: "session-1",
      },
      "users:update",
    ),
    false,
  );
});

test("returns false without throwing for hostile getters and invalid proxies", () => {
  const hostileGetter = {
    userId: "user-001",
    role: "teacher",
    tenantScope: { kind: "platform" },
    get permissions() {
      throw new Error("hostile getter");
    },
  };
  assert.equal(can(hostileGetter, "users:update"), false);

  const invalidProxy = new Proxy(
    {
      userId: "user-001",
      role: "teacher",
      tenantScope: { kind: "platform" },
      permissions: ["users:update"],
    },
    {
      ownKeys() {
        throw new Error("hostile proxy");
      },
      get() {
        throw new Error("hostile proxy");
      },
    },
  );
  assert.equal(can(invalidProxy, "users:update"), false);
});

test("still accepts an ordinary exact and valid principal object", () => {
  const principal = {
    userId: "user-001",
    role: "school_admin",
    tenantScope: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    permissions: ["users:update"],
  };

  assert.equal(can(principal, "users:update"), true);
  assert.equal(can(principal, "users:read"), false);
});

test("authorization decisions ignore mutated Array.prototype.includes and Set.prototype.has", () => {
  const originalIncludes = Array.prototype.includes;
  const originalHas = Set.prototype.has;
  Array.prototype.includes = () => true;
  Set.prototype.has = () => true;

  try {
    assert.equal(isCanonicalRole("not_a_role"), false);
    assert.equal(isCanonicalRole("teacher"), true);

    const principal = principalWith(["users:update"]);
    assert.equal(can(principal, "users:update"), true);
    assert.equal(can(principal, "users:disable"), false);
  } finally {
    Array.prototype.includes = originalIncludes;
    Set.prototype.has = originalHas;
  }
});

test("returns false without throwing for forged permissions and tenant scopes", () => {
  const redefinedMap = ["users:disable"];
  Object.defineProperty(redefinedMap, "map", {
    value() {
      return ["users:disable"];
    },
    enumerable: true,
  });
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "super_admin",
        tenantScope: { kind: "platform" },
        permissions: redefinedMap,
      },
      "users:disable",
    ),
    false,
  );

  const sparseInherited = [];
  sparseInherited.length = 1;
  Object.setPrototypeOf(sparseInherited, { 0: "users:disable" });
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "super_admin",
        tenantScope: { kind: "platform" },
        permissions: sparseInherited,
      },
      "users:disable",
    ),
    false,
  );

  const enormousSparse = [];
  enormousSparse.length = 4294967295;
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "super_admin",
        tenantScope: { kind: "platform" },
        permissions: enormousSparse,
      },
      "users:disable",
    ),
    false,
  );

  let getterCalls = 0;
  const accessorPermissions = [];
  Object.defineProperty(accessorPermissions, "0", {
    get() {
      getterCalls += 1;
      return "users:disable";
    },
    enumerable: true,
    configurable: true,
  });
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "super_admin",
        tenantScope: { kind: "platform" },
        permissions: accessorPermissions,
      },
      "users:disable",
    ),
    false,
  );
  assert.equal(getterCalls, 0);

  const hugeLengthProxy = new Proxy([], {
    get(target, property) {
      if (property === "length") return 4294967295;
      return Reflect.get(target, property);
    },
    ownKeys() {
      return ["length"];
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "length") {
        return {
          configurable: true,
          enumerable: false,
          writable: true,
          value: 4294967295,
        };
      }
      return undefined;
    },
    getPrototypeOf() {
      return Array.prototype;
    },
  });
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "super_admin",
        tenantScope: { kind: "platform" },
        permissions: hugeLengthProxy,
      },
      "users:disable",
    ),
    false,
  );

  const inheritedKindScope = Object.create({ kind: "platform" });
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "super_admin",
        tenantScope: inheritedKindScope,
        permissions: ["users:disable"],
      },
      "users:disable",
    ),
    false,
  );

  const inheritedCountryScope = Object.create({ countryCode: "CD" });
  inheritedCountryScope.kind = "country";
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "country_admin",
        tenantScope: inheritedCountryScope,
        permissions: ["users:disable"],
      },
      "users:disable",
    ),
    false,
  );

  const scopeWithSymbol = { kind: "platform" };
  scopeWithSymbol[Symbol("extra")] = "nope";
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "super_admin",
        tenantScope: scopeWithSymbol,
        permissions: ["users:disable"],
      },
      "users:disable",
    ),
    false,
  );
});
