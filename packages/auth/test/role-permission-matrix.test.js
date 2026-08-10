import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_PERMISSION_CATALOG,
  CANONICAL_ROLES,
  can,
  createAuthPrincipal,
} from "../src/index.js";

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

const EXPECTED_ALLOWED_BY_ROLE = Object.freeze(
  Object.assign(Object.create(null), {
    super_admin: Object.freeze([
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
    ]),
    country_admin: Object.freeze([
      "countries:read",
      "countries:update",
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
    ]),
    school_admin: Object.freeze([
      "schools:read",
      "schools:update",
      "users:create",
      "users:read",
      "users:update",
      "users:disable",
      "roles:assign",
      "sessions:revoke",
    ]),
    principal: Object.freeze([
      "schools:read",
      "users:create",
      "users:read",
      "users:update",
      "users:disable",
      "roles:assign",
      "sessions:revoke",
    ]),
    secretary: Object.freeze([
      "schools:read",
      "users:create",
      "users:read",
      "users:update",
    ]),
    prefet: Object.freeze(["schools:read", "users:read"]),
    accountant: Object.freeze([]),
    teacher: Object.freeze([]),
    parent: Object.freeze([]),
    student: Object.freeze([]),
  }),
);

const EXPECTED_ALLOWED_COUNTS = Object.freeze(
  Object.assign(Object.create(null), {
    super_admin: 15,
    country_admin: 12,
    school_admin: 8,
    principal: 7,
    secretary: 4,
    prefet: 2,
    accountant: 0,
    teacher: 0,
    parent: 0,
    student: 0,
  }),
);

function principalInput(role, permissions, overrides = {}) {
  const scopeKind = Reflect.get(REQUIRED_KIND_BY_ROLE, role);
  return {
    userId: "user-001",
    role,
    tenantScope: Reflect.get(SCOPE_FIXTURES, scopeKind),
    permissions,
    ...overrides,
  };
}

function isExpectedAllowed(role, permission) {
  const allowed = Reflect.get(EXPECTED_ALLOWED_BY_ROLE, role);
  for (let index = 0; index < allowed.length; index += 1) {
    if (Reflect.get(allowed, String(index)) === permission) {
      return true;
    }
  }
  return false;
}

test("exhaustive matrix accepts exactly 48 role permission combinations and rejects 102", () => {
  let accepted = 0;
  let rejected = 0;

  for (let roleIndex = 0; roleIndex < CANONICAL_ROLES.length; roleIndex += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(roleIndex));
    let roleAccepted = 0;

    for (let permissionIndex = 0; permissionIndex < AUTH_PERMISSION_CATALOG.length; permissionIndex += 1) {
      const permission = Reflect.get(AUTH_PERMISSION_CATALOG, String(permissionIndex));
      const expectedAllowed = isExpectedAllowed(role, permission);

      if (expectedAllowed) {
        const principal = createAuthPrincipal(principalInput(role, [permission]));
        assert.deepEqual(principal.permissions, [permission]);
        assert.equal(can(principal, permission), true);
        accepted += 1;
        roleAccepted += 1;
      } else {
        assert.throws(
          () => createAuthPrincipal(principalInput(role, [permission])),
          (error) =>
            error &&
            error.name === "AuthPrincipalValidationError" &&
            error.code === "AUTH_PRINCIPAL_INVALID" &&
            /not allowed for role/.test(String(error.message)),
        );
        assert.equal(can(principalInput(role, [permission]), permission), false);
        rejected += 1;
      }
    }

    assert.equal(roleAccepted, Reflect.get(EXPECTED_ALLOWED_COUNTS, role));
  }

  assert.equal(accepted, 48);
  assert.equal(rejected, 102);
});

test("every role accepts an empty permission list", () => {
  for (let index = 0; index < CANONICAL_ROLES.length; index += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(index));
    const principal = createAuthPrincipal(principalInput(role, []));
    assert.deepEqual(principal.permissions, []);
    assert.equal(Object.isFrozen(principal), true);
    assert.equal(Object.isFrozen(principal.permissions), true);
  }
});

test("each role can carry all of its allowed permissions together in provided order", () => {
  for (let roleIndex = 0; roleIndex < CANONICAL_ROLES.length; roleIndex += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(roleIndex));
    const allowed = Reflect.get(EXPECTED_ALLOWED_BY_ROLE, role);
    const principal = createAuthPrincipal(principalInput(role, [...allowed]));
    assert.deepEqual(principal.permissions, [...allowed]);
    assert.equal(Object.isFrozen(principal.permissions), true);

    for (let index = 0; index < allowed.length; index += 1) {
      const permission = Reflect.get(allowed, String(index));
      assert.equal(can(principal, permission), true);
    }
  }
});

test("duplicates remain rejected under the role permission matrix", () => {
  assert.throws(
    () => createAuthPrincipal(principalInput("school_admin", ["users:update", "users:update"])),
    /duplicates/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("secretary", ["schools:read", "schools:read"])),
    /duplicates/,
  );
});

test("canonical out-of-catalog permissions remain rejected", () => {
  assert.throws(
    () => createAuthPrincipal(principalInput("super_admin", ["notes:read"])),
    /catalogued auth permission/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("school_admin", ["payments:write"])),
    /catalogued/,
  );
});

test("mandatory CTO accept and reject examples remain exact", () => {
  assert.deepEqual(
    createAuthPrincipal(principalInput("super_admin", ["platform:manage"])).permissions,
    ["platform:manage"],
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("country_admin", ["platform:manage"])),
    /not allowed for role country_admin/,
  );
  assert.deepEqual(
    createAuthPrincipal(principalInput("country_admin", ["schools:create"])).permissions,
    ["schools:create"],
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("school_admin", ["countries:read"])),
    /not allowed for role school_admin/,
  );
  assert.deepEqual(
    createAuthPrincipal(principalInput("principal", ["roles:assign"])).permissions,
    ["roles:assign"],
  );
  assert.deepEqual(
    createAuthPrincipal(principalInput("secretary", ["users:update"])).permissions,
    ["users:update"],
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("secretary", ["users:disable"])),
    /not allowed for role secretary/,
  );
  assert.deepEqual(
    createAuthPrincipal(principalInput("prefet", ["users:read"])).permissions,
    ["users:read"],
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("prefet", ["users:update"])),
    /not allowed for role prefet/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("teacher", ["users:read"])),
    /not allowed for role teacher/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("parent", ["schools:read"])),
    /not allowed for role parent/,
  );
  assert.throws(
    () => createAuthPrincipal(principalInput("student", ["sessions:revoke"])),
    /not allowed for role student/,
  );
});

test("can is true only for a carried and role-allowed permission", () => {
  const principal = createAuthPrincipal(
    principalInput("school_admin", ["schools:read", "users:update"]),
  );
  assert.equal(can(principal, "schools:read"), true);
  assert.equal(can(principal, "users:update"), true);
  assert.equal(can(principal, "users:disable"), false);
  assert.equal(can(principal, "roles:assign"), false);
});

test("can remains false for a role-forbidden permission injected into a forged principal", () => {
  const forgedTeacher = {
    userId: "user-001",
    role: "teacher",
    tenantScope: Reflect.get(SCOPE_FIXTURES, "school"),
    permissions: ["users:read"],
  };
  assert.equal(can(forgedTeacher, "users:read"), false);

  const forgedSecretary = {
    userId: "user-001",
    role: "secretary",
    tenantScope: Reflect.get(SCOPE_FIXTURES, "school"),
    permissions: ["users:disable", "roles:assign", "sessions:revoke"],
  };
  assert.equal(can(forgedSecretary, "users:disable"), false);
  assert.equal(can(forgedSecretary, "roles:assign"), false);
  assert.equal(can(forgedSecretary, "sessions:revoke"), false);
});

test("role and tenant compatibility matrix remains enforced", () => {
  let accepted = 0;
  let rejected = 0;

  for (let roleIndex = 0; roleIndex < CANONICAL_ROLES.length; roleIndex += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(roleIndex));
    const requiredKind = Reflect.get(REQUIRED_KIND_BY_ROLE, role);

    for (let scopeIndex = 0; scopeIndex < SCOPE_KINDS.length; scopeIndex += 1) {
      const scopeKind = Reflect.get(SCOPE_KINDS, String(scopeIndex));
      const input = {
        userId: "user-001",
        role,
        tenantScope: Reflect.get(SCOPE_FIXTURES, scopeKind),
        permissions: [],
      };

      if (scopeKind === requiredKind) {
        const principal = createAuthPrincipal(input);
        assert.equal(principal.role, role);
        assert.equal(principal.tenantScope.kind, scopeKind);
        accepted += 1;
      } else {
        assert.throws(
          () => createAuthPrincipal(input),
          /incompatible with tenant scope kind/,
        );
        assert.equal(can(input, "users:read"), false);
        rejected += 1;
      }
    }
  }

  assert.equal(accepted, 10);
  assert.equal(rejected, 20);
});

test("matrix decisions ignore Object and Array prototype pollution", () => {
  const hadConstructor = Object.hasOwn(Object.prototype, "constructor");
  const previousConstructor = Object.prototype.constructor;
  const originalIncludes = Array.prototype.includes;
  const originalSome = Array.prototype.some;
  const originalFind = Array.prototype.find;
  const originalHas = Set.prototype.has;

  Object.prototype.constructor = true;
  Array.prototype.includes = () => true;
  Array.prototype.some = () => true;
  Array.prototype.find = () => "platform:manage";
  Set.prototype.has = () => true;

  try {
    assert.throws(
      () => createAuthPrincipal(principalInput("teacher", ["users:read"])),
      /not allowed for role teacher/,
    );
    assert.equal(can(principalInput("teacher", ["users:read"]), "users:read"), false);

    const principal = createAuthPrincipal(principalInput("secretary", ["users:update"]));
    assert.equal(can(principal, "users:update"), true);
    assert.equal(can(principal, "users:disable"), false);
    assert.equal(can(principal, "platform:manage"), false);

    assert.throws(
      () => createAuthPrincipal(principalInput("country_admin", ["platform:manage"])),
      /not allowed for role country_admin/,
    );
  } finally {
    Array.prototype.includes = originalIncludes;
    Array.prototype.some = originalSome;
    Array.prototype.find = originalFind;
    Set.prototype.has = originalHas;
    if (hadConstructor) Object.prototype.constructor = previousConstructor;
    else delete Object.prototype.constructor;
  }
});

test("hostile getters are never invoked and hostile proxies make can return false", () => {
  let getterCalls = 0;
  const hostilePermissions = [];
  Object.defineProperty(hostilePermissions, "0", {
    get() {
      getterCalls += 1;
      return "users:update";
    },
    enumerable: true,
    configurable: true,
  });

  assert.throws(
    () => createAuthPrincipal(principalInput("school_admin", hostilePermissions)),
    /permissions\[0\] must be a data property/,
  );
  assert.equal(getterCalls, 0);
  assert.equal(can(principalInput("school_admin", hostilePermissions), "users:update"), false);
  assert.equal(getterCalls, 0);

  const hostileProxy = new Proxy(
    {
      userId: "user-001",
      role: "school_admin",
      tenantScope: Reflect.get(SCOPE_FIXTURES, "school"),
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
  assert.equal(can(hostileProxy, "users:update"), false);
});

test("unknown roles and legacy aliases remain rejected", () => {
  assert.throws(
    () =>
      createAuthPrincipal({
        userId: "user-001",
        role: "global_admin",
        tenantScope: Reflect.get(SCOPE_FIXTURES, "platform"),
        permissions: [],
      }),
    /unsupported auth principal role/,
  );
  assert.throws(
    () =>
      createAuthPrincipal({
        userId: "user-001",
        role: "Super Administrateur Somafrik",
        tenantScope: Reflect.get(SCOPE_FIXTURES, "platform"),
        permissions: ["platform:manage"],
      }),
    /unsupported auth principal role/,
  );
  assert.throws(
    () =>
      createAuthPrincipal({
        userId: "user-001",
        role: "Admin School",
        tenantScope: Reflect.get(SCOPE_FIXTURES, "school"),
        permissions: ["schools:read"],
      }),
    /unsupported auth principal role/,
  );
  assert.equal(
    can(
      {
        userId: "user-001",
        role: "parent_student",
        tenantScope: Reflect.get(SCOPE_FIXTURES, "school"),
        permissions: ["users:read"],
      },
      "users:read",
    ),
    false,
  );
});
