import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAuthPrincipal } from "../src/index.js";

const authIndexUrl = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/index.js"),
).href;

function baseInput(overrides = {}) {
  return {
    userId: "user-001",
    role: "school_admin",
    tenantScope: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    permissions: ["schools:read"],
    ...overrides,
  };
}

test("creates an immutable principal with a platform tenant scope", () => {
  const principal = createAuthPrincipal(
    baseInput({
      role: "super_admin",
      tenantScope: { kind: "platform" },
      permissions: [],
    }),
  );

  assert.deepEqual(principal, {
    userId: "user-001",
    role: "super_admin",
    tenantScope: { kind: "platform" },
    permissions: [],
  });
  assert.equal(Object.isFrozen(principal), true);
  assert.equal(Object.isFrozen(principal.tenantScope), true);
  assert.equal(Object.isFrozen(principal.permissions), true);
});

test("creates an immutable principal with a country tenant scope", () => {
  const principal = createAuthPrincipal(
    baseInput({
      role: "country_admin",
      tenantScope: { kind: "country", countryCode: "CD" },
    }),
  );

  assert.equal(principal.role, "country_admin");
  assert.deepEqual(principal.tenantScope, { kind: "country", countryCode: "CD" });
});

test("creates an immutable principal with a school tenant scope", () => {
  const principal = createAuthPrincipal(baseInput());

  assert.equal(principal.role, "school_admin");
  assert.deepEqual(principal.tenantScope, {
    kind: "school",
    countryCode: "CD",
    schoolCode: "CD-2026-0001",
  });
});

test("copies permissions defensively and keeps an empty permissions list valid", () => {
  const sourcePermissions = ["users:update"];
  const principal = createAuthPrincipal(baseInput({ permissions: sourcePermissions }));

  sourcePermissions.push("users:read");
  assert.deepEqual(principal.permissions, ["users:update"]);
  assert.equal(Object.isFrozen(principal.permissions), true);

  const emptyPrincipal = createAuthPrincipal(baseInput({ permissions: [] }));
  assert.deepEqual(emptyPrincipal.permissions, []);
});

test("rejects invalid userId values without type coercion", () => {
  assert.throws(() => createAuthPrincipal(baseInput({ userId: undefined })), /userId/);
  assert.throws(() => createAuthPrincipal(baseInput({ userId: "" })), /userId/);
  assert.throws(() => createAuthPrincipal(baseInput({ userId: "   " })), /userId/);
  assert.throws(() => createAuthPrincipal(baseInput({ userId: 42 })), /userId/);
});

test("rejects missing, unknown, or legacy alias roles", () => {
  assert.throws(() => createAuthPrincipal(baseInput({ role: undefined })), /role/);
  assert.throws(() => createAuthPrincipal(baseInput({ role: "global_admin" })), /role/);
  assert.throws(
    () => createAuthPrincipal(baseInput({ role: "Super Administrateur Somafrik" })),
    /role/,
  );
  assert.throws(() => createAuthPrincipal(baseInput({ role: "Admin School" })), /role/);
  assert.throws(() => createAuthPrincipal(baseInput({ role: "Secrétaire" })), /role/);
  assert.throws(() => createAuthPrincipal(baseInput({ role: "parent_student" })), /role/);
});

test("rejects incomplete, invalid, or ambiguous tenant scopes", () => {
  assert.throws(
    () => createAuthPrincipal(baseInput({ tenantScope: { kind: "country" } })),
    /countryCode/,
  );
  assert.throws(
    () =>
      createAuthPrincipal(
        baseInput({
          tenantScope: { kind: "school", countryCode: "CD" },
        }),
      ),
    /schoolCode/,
  );
  assert.throws(
    () =>
      createAuthPrincipal(
        baseInput({
          tenantScope: {
            kind: "platform",
            countryCode: "CD",
          },
        }),
      ),
    /forbidden for platform/,
  );
  assert.throws(
    () =>
      createAuthPrincipal(
        baseInput({
          tenantScope: {
            kind: "school",
            countryCode: "CD",
            schoolCode: "CD-2026-0001",
            organizationCode: "legacy-tenant",
          },
        }),
      ),
    /unsupported tenant scope fields/,
  );
});

test("rejects missing, invalid, or empty permission entries", () => {
  const withoutPermissions = {
    userId: "user-001",
    role: "teacher",
    tenantScope: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
  };
  assert.throws(() => createAuthPrincipal(withoutPermissions), /permissions is required/);
  assert.throws(() => createAuthPrincipal(baseInput({ permissions: null })), /permissions/);
  assert.throws(() => createAuthPrincipal(baseInput({ permissions: "users:read" })), /permissions/);
  assert.throws(
    () => createAuthPrincipal(baseInput({ permissions: [""] })),
    /permissions\[0\] must be a canonical permission token/,
  );
  assert.throws(
    () => createAuthPrincipal(baseInput({ permissions: ["  "] })),
    /permissions\[0\] must be a canonical permission token/,
  );
  assert.throws(
    () => createAuthPrincipal(baseInput({ permissions: [1] })),
    /permissions\[0\] must be a canonical permission token/,
  );
});

test("rejects unexpected principal fields", () => {
  assert.throws(
    () =>
      createAuthPrincipal(
        baseInput({
          sessionId: "session-1",
        }),
      ),
    /unsupported auth principal fields: sessionId/,
  );
});

test("rejects inherited userId, role, or tenantScope values", () => {
  const inheritedIdentity = Object.create({
    userId: "attacker",
    role: "super_admin",
    tenantScope: { kind: "platform" },
  });
  inheritedIdentity.permissions = ["users:disable"];

  assert.throws(() => createAuthPrincipal(inheritedIdentity), /userId is required as an own property/);

  const inheritedRoleOnly = {
    userId: "user-001",
    tenantScope: { kind: "platform" },
    permissions: ["users:disable"],
  };
  Object.setPrototypeOf(inheritedRoleOnly, { role: "super_admin" });
  assert.throws(() => createAuthPrincipal(inheritedRoleOnly), /role is required as an own property/);

  const inheritedScopeOnly = {
    userId: "user-001",
    role: "teacher",
    permissions: ["users:disable"],
  };
  Object.setPrototypeOf(inheritedScopeOnly, { tenantScope: { kind: "platform" } });
  assert.throws(
    () => createAuthPrincipal(inheritedScopeOnly),
    /tenantScope is required as an own property/,
  );
});

test("rejects non-enumerable and Symbol extra own properties", () => {
  const withHiddenField = baseInput();
  Object.defineProperty(withHiddenField, "hidden", {
    value: "secret",
    enumerable: false,
  });
  assert.throws(
    () => createAuthPrincipal(withHiddenField),
    /unsupported auth principal fields: hidden/,
  );

  const withSymbolField = baseInput();
  const marker = Symbol("extra");
  withSymbolField[marker] = "nope";
  assert.throws(
    () => createAuthPrincipal(withSymbolField),
    /unsupported auth principal fields/,
  );
});

test("accepts an ordinary object and Object.create(null) with exact own fields", () => {
  const ordinary = createAuthPrincipal(baseInput({ permissions: [] }));
  assert.equal(ordinary.role, "school_admin");

  const nullProto = Object.create(null);
  nullProto.userId = "user-001";
  nullProto.role = "teacher";
  nullProto.tenantScope = {
    kind: "school",
    countryCode: "CD",
    schoolCode: "CD-2026-0001",
  };
  nullProto.permissions = ["users:update"];

  const principal = createAuthPrincipal(nullProto);
  assert.deepEqual(principal.permissions, ["users:update"]);
  assert.equal(Object.isFrozen(principal), true);
});

test("rejects permissions arrays with redefined map, holes, or inherited entries", () => {
  const withRedefinedMap = ["users:disable"];
  Object.defineProperty(withRedefinedMap, "map", {
    value() {
      return [];
    },
    enumerable: true,
  });
  assert.throws(
    () => createAuthPrincipal(baseInput({ permissions: withRedefinedMap })),
    /unsupported permissions own keys: map/,
  );

  const sparseInherited = [];
  sparseInherited.length = 1;
  Object.setPrototypeOf(sparseInherited, { 0: "users:disable" });
  assert.throws(
    () => createAuthPrincipal(baseInput({ permissions: sparseInherited })),
    /permissions must be a dense own-keyed array/,
  );

  const withHiddenPermissionMeta = ["users:update"];
  Object.defineProperty(withHiddenPermissionMeta, "hidden", {
    value: "secret",
    enumerable: false,
  });
  assert.throws(
    () => createAuthPrincipal(baseInput({ permissions: withHiddenPermissionMeta })),
    /unsupported permissions own keys: hidden/,
  );

  const withSymbolPermissionMeta = ["users:update"];
  withSymbolPermissionMeta[Symbol("extra")] = "nope";
  assert.throws(
    () => createAuthPrincipal(baseInput({ permissions: withSymbolPermissionMeta })),
    /unsupported permissions own keys/,
  );
});

test("accepts a dense permissions array with all catalogued entries", () => {
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
    baseInput({
      role: "super_admin",
      tenantScope: { kind: "platform" },
      permissions,
    }),
  );
  assert.equal(principal.permissions.length, 15);
  assert.equal(Reflect.get(principal.permissions, "14"), "sessions:revoke");
});

test("rejects numeric accessor descriptors and never invokes their getters", () => {
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
    () => createAuthPrincipal(baseInput({ permissions })),
    /permissions\[0\] must be a data property/,
  );
  assert.equal(getterCalls, 0);
});

test("rejects an enormous sparse permissions length in a child process with timeout", () => {
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
});
