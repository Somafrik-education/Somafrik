import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_ROLES, can, createAuthPrincipal } from "../src/index.js";

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

function principalInput(role, scopeKind, permissions = ["notes:write"]) {
  return {
    userId: "user-001",
    role,
    tenantScope: Reflect.get(SCOPE_FIXTURES, scopeKind),
    permissions,
  };
}

test("accepts the ten authorized role and tenant scope combinations", () => {
  for (let index = 0; index < CANONICAL_ROLES.length; index += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(index));
    const scopeKind = Reflect.get(REQUIRED_KIND_BY_ROLE, role);
    const principal = createAuthPrincipal(principalInput(role, scopeKind, []));

    assert.equal(principal.role, role);
    assert.equal(principal.tenantScope.kind, scopeKind);
    assert.equal(Object.isFrozen(principal), true);
    assert.equal(Object.isFrozen(principal.tenantScope), true);
    assert.equal(Object.isFrozen(principal.permissions), true);
  }
});

test("rejects every incompatible role and tenant scope combination", () => {
  for (let roleIndex = 0; roleIndex < CANONICAL_ROLES.length; roleIndex += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(roleIndex));
    const requiredKind = Reflect.get(REQUIRED_KIND_BY_ROLE, role);

    for (let scopeIndex = 0; scopeIndex < SCOPE_KINDS.length; scopeIndex += 1) {
      const scopeKind = Reflect.get(SCOPE_KINDS, String(scopeIndex));
      if (scopeKind === requiredKind) {
        continue;
      }

      assert.throws(
        () => createAuthPrincipal(principalInput(role, scopeKind)),
        (error) =>
          error &&
          error.name === "AuthPrincipalValidationError" &&
          error.code === "AUTH_PRINCIPAL_INVALID" &&
          /incompatible with tenant scope kind/.test(String(error.message)),
      );
    }
  }
});

test("rejects the explicit incompatible CTO cases", () => {
  assert.throws(
    () => createAuthPrincipal(principalInput("super_admin", "school")),
    /role super_admin is incompatible with tenant scope kind school/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("country_admin", "platform")),
    /role country_admin is incompatible with tenant scope kind platform/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("teacher", "country")),
    /role teacher is incompatible with tenant scope kind country/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("school_admin", "platform")),
    /role school_admin is incompatible with tenant scope kind platform/,
  );
});

test("can returns false for incompatible role and tenant scope without throwing", () => {
  assert.equal(can(principalInput("super_admin", "school"), "notes:write"), false);
  assert.equal(can(principalInput("country_admin", "platform"), "notes:write"), false);
  assert.equal(can(principalInput("teacher", "country"), "notes:write"), false);
  assert.equal(can(principalInput("school_admin", "platform"), "notes:write"), false);
});

test("exact permissions still work for a compatible principal", () => {
  const principal = createAuthPrincipal(principalInput("teacher", "school", ["notes:write"]));
  assert.equal(can(principal, "notes:write"), true);
  assert.equal(can(principal, "students:delete"), false);
});

test("unknown roles and legacy aliases remain rejected", () => {
  assert.throws(
    () => createAuthPrincipal(principalInput("global_admin", "platform")),
    /unsupported auth principal role/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("Super Administrateur Somafrik", "platform")),
    /unsupported auth principal role/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("Admin School", "school")),
    /unsupported auth principal role/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("parent_student", "school")),
    /unsupported auth principal role/,
  );
});

test("role tenant checks ignore mutated Array.prototype.includes and Set.prototype.has", () => {
  const originalIncludes = Array.prototype.includes;
  const originalHas = Set.prototype.has;
  Array.prototype.includes = () => true;
  Set.prototype.has = () => true;

  try {
    assert.throws(
      () => createAuthPrincipal(principalInput("teacher", "platform")),
      /incompatible with tenant scope kind/,
    );
    assert.equal(can(principalInput("teacher", "platform"), "notes:write"), false);

    const principal = createAuthPrincipal(principalInput("teacher", "school", ["notes:write"]));
    assert.equal(can(principal, "notes:write"), true);
    assert.equal(can(principal, "students:delete"), false);
  } finally {
    Array.prototype.includes = originalIncludes;
    Set.prototype.has = originalHas;
  }
});
