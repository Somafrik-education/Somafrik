import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_PERMISSION_CATALOG,
  CANONICAL_ROLES,
  can,
  createAuthPrincipal,
  isCataloguedAuthPermission,
} from "../src/index.js";

const EXPECTED_CATALOG = Object.freeze([
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
]);

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

function principalInput(permissions, overrides = {}) {
  return {
    userId: "user-001",
    role: "school_admin",
    tenantScope: Reflect.get(SCOPE_FIXTURES, "school"),
    permissions,
    ...overrides,
  };
}

test("exposes the exact immutable closed auth permission catalog", () => {
  assert.deepEqual(AUTH_PERMISSION_CATALOG, EXPECTED_CATALOG);
  assert.equal(AUTH_PERMISSION_CATALOG.length, 15);
  assert.equal(Object.isFrozen(AUTH_PERMISSION_CATALOG), true);

  const seen = Object.create(null);
  for (let index = 0; index < AUTH_PERMISSION_CATALOG.length; index += 1) {
    const token = Reflect.get(AUTH_PERMISSION_CATALOG, String(index));
    assert.equal(typeof token, "string");
    assert.match(token, /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/);
    assert.equal(Object.hasOwn(seen, token), false);
    seen[token] = true;
    assert.equal(isCataloguedAuthPermission(token), true);
  }

  assert.throws(() => {
    AUTH_PERMISSION_CATALOG.push("notes:read");
  }, TypeError);
  assert.throws(() => {
    AUTH_PERMISSION_CATALOG[0] = "notes:read";
  }, TypeError);
  assert.deepEqual(AUTH_PERMISSION_CATALOG, EXPECTED_CATALOG);
});

test("createAuthPrincipal accepts every catalogued permission and rejects out-of-catalog tokens", () => {
  for (let index = 0; index < AUTH_PERMISSION_CATALOG.length; index += 1) {
    const token = Reflect.get(AUTH_PERMISSION_CATALOG, String(index));
    const principal = createAuthPrincipal(
      principalInput([token], {
        role: "super_admin",
        tenantScope: Reflect.get(SCOPE_FIXTURES, "platform"),
      }),
    );
    assert.deepEqual(principal.permissions, [token]);
    assert.equal(Object.isFrozen(principal), true);
    assert.equal(Object.isFrozen(principal.permissions), true);
    assert.equal(can(principal, token), true);
  }

  assert.throws(
    () => createAuthPrincipal(principalInput(["notes:read"])),
    (error) =>
      error &&
      error.name === "AuthPrincipalValidationError" &&
      error.code === "AUTH_PRINCIPAL_INVALID" &&
      /catalogued auth permission/.test(String(error.message)),
  );
  assert.throws(() => createAuthPrincipal(principalInput(["payments:write"])), /catalogued/);
  assert.throws(() => createAuthPrincipal(principalInput(["students:read"])), /catalogued/);
  assert.throws(() => createAuthPrincipal(principalInput(["*"])), /canonical permission token/);
  assert.throws(
    () => createAuthPrincipal(principalInput(["users:update", "users:update"])),
    /duplicates/,
  );
  assert.deepEqual(createAuthPrincipal(principalInput([])).permissions, []);
});

test("can is exact and fail-closed for catalog membership", () => {
  const principal = createAuthPrincipal(principalInput(["users:read", "schools:update"]));
  assert.equal(can(principal, "users:read"), true);
  assert.equal(can(principal, "schools:update"), true);
  assert.equal(can(principal, "users:update"), false);
  assert.equal(can(principal, "notes:read"), false);
  assert.equal(can(principal, "payments:write"), false);
  assert.equal(can(principal, "students:read"), false);
  assert.equal(can(principal, "constructor:read"), false);
  assert.equal(can(principal, "tostring:read"), false);
  assert.equal(isCataloguedAuthPermission("constructor:read"), false);
  assert.equal(isCataloguedAuthPermission("tostring:read"), false);
});

test("catalog membership ignores mutated prototypes", () => {
  const hadConstructor = Object.hasOwn(Object.prototype, "constructor");
  const previousConstructor = Object.prototype.constructor;
  const originalIncludes = Array.prototype.includes;
  const originalSome = Array.prototype.some;
  const originalHas = Set.prototype.has;

  Object.prototype.constructor = true;
  Array.prototype.includes = () => true;
  Array.prototype.some = () => true;
  Set.prototype.has = () => true;

  try {
    assert.equal(isCataloguedAuthPermission("notes:read"), false);
    assert.equal(isCataloguedAuthPermission("users:read"), true);
    assert.throws(() => createAuthPrincipal(principalInput(["notes:read"])), /catalogued/);
    assert.equal(can(principalInput(["users:read"]), "notes:read"), false);
    assert.equal(can(principalInput(["users:read"]), "users:read"), true);
  } finally {
    Array.prototype.includes = originalIncludes;
    Array.prototype.some = originalSome;
    Set.prototype.has = originalHas;
    if (hadConstructor) Object.prototype.constructor = previousConstructor;
    else delete Object.prototype.constructor;
  }
});

test("role and tenant matrix remains enforced with catalogued permissions only", () => {
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
    assert.equal(can(principal, "users:read"), false);

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
          "users:read",
        ),
        false,
      );
    }
  }
});
