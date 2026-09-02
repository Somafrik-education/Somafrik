import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CANONICAL_ROLES, can, createAuthPrincipal } from "../src/index.js";

const authIndexUrl = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/index.js"),
).href;

const SCOPE_FIXTURES = Object.freeze(
  Object.assign(Object.create(null), {
    platform: Object.freeze({ kind: "platform" }),
    country: Object.freeze({ kind: "country", countryCode: "CD" }),
    school: Object.freeze({
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    }),
  }),
);

const REQUIRED_KIND_BY_ROLE = Object.freeze(
  Object.assign(Object.create(null), {
    super_admin: "platform",
    country_admin: "country",
    school_admin: "school",
    principal: "school",
    prefet: "school",
    secretary: "school",
    accountant: "school",
    teacher: "school",
    parent: "school",
    student: "school",
  }),
);

const SCOPE_KINDS = Object.freeze(["platform", "country", "school"]);

function baseInput(permissions, overrides = {}) {
  return {
    userId: "user-001",
    role: "school_admin",
    tenantScope: Reflect.get(SCOPE_FIXTURES, "school"),
    permissions,
    ...overrides,
  };
}

function assertInvalidPermission(permissions, requestedPermission = "users:update") {
  assert.throws(
    () => createAuthPrincipal(baseInput(permissions)),
    (error) =>
      error &&
      error.name === "AuthPrincipalValidationError" &&
      error.code === "AUTH_PRINCIPAL_INVALID",
  );
  assert.equal(can(baseInput(permissions), requestedPermission), false);
}

test("accepts canonical catalogued permission tokens", () => {
  const permissions = ["schools:read", "users:update", "roles:assign", "sessions:revoke"];
  const principal = createAuthPrincipal(baseInput(permissions));
  assert.deepEqual(principal.permissions, permissions);
  assert.equal(Object.isFrozen(principal), true);
  assert.equal(Object.isFrozen(principal.permissions), true);
  assert.equal(can(principal, "roles:assign"), true);
  assert.throws(
    () => createAuthPrincipal(baseInput(["school-users:manage"])),
    /catalogued auth permission/,
  );
});

test("rejects the CTO-listed invalid permission formats", () => {
  const invalidTokens = [
    "*",
    "notes:*",
    "*:read",
    "notes:read:*",
    "notes",
    ":read",
    "notes:",
    " Notes:read",
    "notes:read ",
    "NOTES:READ",
    "notes:read\n",
    "notes:read\t",
    "notes: write",
  ];

  for (let index = 0; index < invalidTokens.length; index += 1) {
    const token = Reflect.get(invalidTokens, String(index));
    assertInvalidPermission([token], "users:update");
    assert.equal(can(baseInput(["users:update"]), token), false);
  }

  assertInvalidPermission([1], "users:update");
  assertInvalidPermission([null], "users:update");
});

test("rejects exact duplicates and keeps near-duplicates distinct", () => {
  assert.throws(
    () => createAuthPrincipal(baseInput(["users:update", "users:update"])),
    /duplicates an earlier permission token/,
  );

  const principal = createAuthPrincipal(baseInput(["users:update", "users:read"]));
  assert.deepEqual(principal.permissions, ["users:update", "users:read"]);
  assert.equal(can(principal, "users:update"), true);
  assert.equal(can(principal, "users:read"), true);
});

test("accepts an empty permissions list and a dense list of all catalogued tokens", () => {
  const emptyPrincipal = createAuthPrincipal(baseInput([]));
  assert.deepEqual(emptyPrincipal.permissions, []);

  const permissions = [
    "platform:manage",
    "countries:create",
    "countries:read",
    "countries:update",
    "countries:disable",
    "schools:create",
    "schools:read",
    "schools:update",
    "schools:disable",
    "users:create",
    "users:read",
    "users:update",
    "users:disable",
    "roles:assign",
    "sessions:revoke",
  ];
  const principal = createAuthPrincipal(
    baseInput(permissions, {
      role: "super_admin",
      tenantScope: { kind: "platform" },
    }),
  );
  assert.equal(principal.permissions.length, 15);
  assert.equal(can(principal, "platform:manage"), true);
  assert.equal(can(principal, "sessions:revoke"), true);
});

test("rejects accessor descriptors without invoking getters", () => {
  let getterCalls = 0;
  const permissions = [];
  Object.defineProperty(permissions, "0", {
    get() {
      getterCalls += 1;
      return "users:disable";
    },
    enumerable: true,
    configurable: true,
  });

  assert.throws(
    () => createAuthPrincipal(baseInput(permissions)),
    /permissions\[0\] must be a data property/,
  );
  assert.equal(getterCalls, 0);
  assert.equal(can(baseInput(permissions), "users:disable"), false);
  assert.equal(getterCalls, 0);
});

test("rejects enormous sparse arrays and hostile proxies without mass traversal", () => {
  const enormousSparse = [];
  enormousSparse.length = 4294967295;
  assert.equal(can(baseInput(enormousSparse), "users:disable"), false);

  const script = `
import { createAuthPrincipal } from ${JSON.stringify(authIndexUrl)};
const permissions = [];
permissions.length = 4294967295;
try {
  createAuthPrincipal({
    userId: "user-001",
    role: "teacher",
    tenantScope: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    permissions,
  });
  process.exit(2);
} catch (error) {
  if (error && /dense own-keyed array/.test(String(error.message))) {
    process.exit(0);
  }
  process.exit(3);
}
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 2000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);

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
  assert.equal(can(baseInput(hugeLengthProxy), "users:disable"), false);
});

test("duplicate detection ignores Object.prototype pollution and rejects constructor tokens", () => {
  const hadConstructor = Object.hasOwn(Object.prototype, "constructor");
  const previousConstructor = Object.prototype.constructor;
  const originalIncludes = Array.prototype.includes;
  const originalHas = Set.prototype.has;

  Object.prototype.constructor = true;
  Array.prototype.includes = () => true;
  Set.prototype.has = () => true;

  try {
    assert.throws(
      () => createAuthPrincipal(baseInput(["constructor:read"])),
      /catalogued auth permission/,
    );
    assert.throws(
      () => createAuthPrincipal(baseInput(["tostring:read"])),
      /catalogued auth permission/,
    );
    assert.equal(can(baseInput(["users:update"]), "constructor:read"), false);
    assert.equal(can(baseInput(["users:update"]), "tostring:read"), false);

    const principal = createAuthPrincipal(baseInput(["users:update", "users:read"]));
    assert.equal(can(principal, "users:update"), true);
    assert.equal(can(principal, "users:disable"), false);

    assert.throws(
      () => createAuthPrincipal(baseInput(["users:update", "users:update"])),
      /duplicates an earlier permission token/,
    );
  } finally {
    Array.prototype.includes = originalIncludes;
    Set.prototype.has = originalHas;
    if (hadConstructor) Object.prototype.constructor = previousConstructor;
    else delete Object.prototype.constructor;
  }
});

test("V2.1b role and tenant matrix remains enforced with canonical permissions", () => {
  for (let roleIndex = 0; roleIndex < CANONICAL_ROLES.length; roleIndex += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(roleIndex));
    const requiredKind = Reflect.get(REQUIRED_KIND_BY_ROLE, role);
    const principal = createAuthPrincipal({
      userId: "user-001",
      role,
      tenantScope: Reflect.get(SCOPE_FIXTURES, requiredKind),
      permissions: [],
    });
    assert.equal(principal.role, role);
    assert.equal(can(principal, "users:update"), false);

    for (let scopeIndex = 0; scopeIndex < SCOPE_KINDS.length; scopeIndex += 1) {
      const scopeKind = Reflect.get(SCOPE_KINDS, String(scopeIndex));
      if (scopeKind === requiredKind) {
        continue;
      }
      assert.throws(
        () =>
          createAuthPrincipal({
            userId: "user-001",
            role,
            tenantScope: Reflect.get(SCOPE_FIXTURES, scopeKind),
            permissions: [],
          }),
        /incompatible with tenant scope kind/,
      );
      assert.equal(
        can(
          {
            userId: "user-001",
            role,
            tenantScope: Reflect.get(SCOPE_FIXTURES, scopeKind),
            permissions: [],
          },
          "users:update",
        ),
        false,
      );
    }
  }
});
