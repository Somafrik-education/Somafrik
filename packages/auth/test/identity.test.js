import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_IDENTITY_STATUS,
  AUTH_PERMISSION_CATALOG,
  CANONICAL_ROLES,
  can,
  createAuthIdentity,
  createAuthPrincipal,
  isAuthIdentityActive,
} from "../src/index.js";

const ACTIVE_CREATED_AT = "2026-08-11T10:15:30.123Z";
const DISABLED_AT = "2026-08-11T12:00:00.000Z";

function activeInput(overrides = {}) {
  return {
    userId: "user-001",
    status: AUTH_IDENTITY_STATUS.ACTIVE,
    createdAt: ACTIVE_CREATED_AT,
    disabledAt: null,
    ...overrides,
  };
}

function disabledInput(overrides = {}) {
  return {
    userId: "user-002",
    status: AUTH_IDENTITY_STATUS.DISABLED,
    createdAt: ACTIVE_CREATED_AT,
    disabledAt: DISABLED_AT,
    ...overrides,
  };
}

function assertIdentityInvalid(input) {
  assert.throws(
    () => createAuthIdentity(input),
    (error) =>
      error &&
      error.name === "AuthIdentityValidationError" &&
      error.code === "AUTH_IDENTITY_INVALID",
  );
  assert.equal(isAuthIdentityActive(input), false);
}

test("exposes the exact immutable ordered identity status catalog", () => {
  assert.deepEqual(AUTH_IDENTITY_STATUS, {
    ACTIVE: "active",
    DISABLED: "disabled",
  });
  assert.deepEqual(Object.keys(AUTH_IDENTITY_STATUS), ["ACTIVE", "DISABLED"]);
  assert.deepEqual(Object.values(AUTH_IDENTITY_STATUS), ["active", "disabled"]);
  assert.equal(Object.isFrozen(AUTH_IDENTITY_STATUS), true);
  assert.throws(() => {
    AUTH_IDENTITY_STATUS.ACTIVE = "enabled";
  }, TypeError);
});

test("creates an immutable active identity distinct from the source input", () => {
  const source = activeInput();
  const identity = createAuthIdentity(source);

  assert.notEqual(identity, source);
  assert.deepEqual(identity, {
    userId: "user-001",
    status: "active",
    createdAt: ACTIVE_CREATED_AT,
    disabledAt: null,
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(isAuthIdentityActive(identity), true);

  source.userId = "mutated";
  source.status = "disabled";
  source.createdAt = "2020-01-01T00:00:00.000Z";
  source.disabledAt = DISABLED_AT;
  assert.deepEqual(identity, {
    userId: "user-001",
    status: "active",
    createdAt: ACTIVE_CREATED_AT,
    disabledAt: null,
  });
  assert.throws(() => {
    identity.userId = "other";
  }, TypeError);
});

test("creates an immutable disabled identity and keeps exact userId and dates", () => {
  const identity = createAuthIdentity(
    disabledInput({
      userId: "Exact-User_Id-42",
      createdAt: "2026-01-02T03:04:05.678Z",
      disabledAt: "2026-01-02T03:04:05.678Z",
    }),
  );

  assert.deepEqual(identity, {
    userId: "Exact-User_Id-42",
    status: "disabled",
    createdAt: "2026-01-02T03:04:05.678Z",
    disabledAt: "2026-01-02T03:04:05.678Z",
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(isAuthIdentityActive(identity), false);
});

test("rejects invalid userId values without normalization", () => {
  assertIdentityInvalid(activeInput({ userId: "" }));
  assertIdentityInvalid(activeInput({ userId: "   " }));
  assertIdentityInvalid(activeInput({ userId: " user-001" }));
  assertIdentityInvalid(activeInput({ userId: "user-001 " }));
  assertIdentityInvalid(activeInput({ userId: "a".repeat(129) }));
  assertIdentityInvalid(activeInput({ userId: "user\n001" }));
  assertIdentityInvalid(activeInput({ userId: "user\u0001001" }));
  assertIdentityInvalid(activeInput({ userId: "user\u007f001" }));
  assertIdentityInvalid(activeInput({ userId: "\u00A0user" }));
  assertIdentityInvalid(activeInput({ userId: "user\u00A0" }));
  assertIdentityInvalid(activeInput({ userId: "user\u0085id" }));
  assertIdentityInvalid(activeInput({ userId: "user\u009Fid" }));
  assertIdentityInvalid(activeInput({ userId: 42 }));
  assertIdentityInvalid(activeInput({ userId: null }));

  const accepted = createAuthIdentity(activeInput({ userId: "a".repeat(128) }));
  assert.equal(accepted.userId.length, 128);
  assert.equal(accepted.userId, "a".repeat(128));
});

test("rejects unknown status aliases case variants and non-strings", () => {
  assertIdentityInvalid(activeInput({ status: "enabled" }));
  assertIdentityInvalid(activeInput({ status: "ACTIVE" }));
  assertIdentityInvalid(activeInput({ status: "Active" }));
  assertIdentityInvalid(activeInput({ status: " active" }));
  assertIdentityInvalid(activeInput({ status: "active " }));
  assertIdentityInvalid(activeInput({ status: "disabled " }));
  assertIdentityInvalid(activeInput({ status: 1 }));
  assertIdentityInvalid(activeInput({ status: null }));
  assertIdentityInvalid(activeInput({ status: undefined }));
});

test("rejects invalid or non-canonical timestamps", () => {
  assertIdentityInvalid(activeInput({ createdAt: "not-a-date" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-13-01T00:00:00.000Z" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-02-30T00:00:00.000Z" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-08-11T10:15:30Z" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-08-11T10:15:30.12Z" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-08-11T10:15:30.1234Z" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-08-11T10:15:30.123+00:00" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-08-11T10:15:30.123+0000" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-08-11t10:15:30.123Z" }));
  assertIdentityInvalid(activeInput({ createdAt: "2026-08-11 10:15:30.123Z" }));
  assertIdentityInvalid(
    disabledInput({
      createdAt: ACTIVE_CREATED_AT,
      disabledAt: "2026-08-11T12:00:00.000+00:00",
    }),
  );
});

test("enforces disabledAt rules for active and disabled identities", () => {
  assertIdentityInvalid(activeInput({ disabledAt: DISABLED_AT }));
  assertIdentityInvalid(activeInput({ disabledAt: ACTIVE_CREATED_AT }));
  assertIdentityInvalid(disabledInput({ disabledAt: null }));
  assertIdentityInvalid(
    disabledInput({
      createdAt: "2026-08-11T12:00:00.000Z",
      disabledAt: "2026-08-11T11:59:59.999Z",
    }),
  );

  const sameInstant = createAuthIdentity(
    disabledInput({
      createdAt: "2026-08-11T12:00:00.000Z",
      disabledAt: "2026-08-11T12:00:00.000Z",
    }),
  );
  assert.equal(sameInstant.disabledAt, sameInstant.createdAt);
});

test("rejects missing extra symbol and inherited properties", () => {
  const missingStatus = {
    userId: "user-001",
    createdAt: ACTIVE_CREATED_AT,
    disabledAt: null,
  };
  assertIdentityInvalid(missingStatus);

  assertIdentityInvalid(activeInput({ email: "user@example.com" }));
  assertIdentityInvalid(activeInput({ role: "teacher" }));

  const withSymbol = activeInput();
  withSymbol[Symbol("extra")] = "nope";
  assertIdentityInvalid(withSymbol);

  const inheritedStatus = {
    userId: "user-001",
    createdAt: ACTIVE_CREATED_AT,
    disabledAt: null,
  };
  Object.setPrototypeOf(inheritedStatus, { status: "active" });
  assertIdentityInvalid(inheritedStatus);

  const inheritedOnly = Object.create({
    userId: "user-001",
    status: "active",
    createdAt: ACTIVE_CREATED_AT,
    disabledAt: null,
  });
  assertIdentityInvalid(inheritedOnly);
});

test("never invokes hostile getters or setters and fails closed on hostile proxies", () => {
  let getterCalls = 0;
  let setterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, "userId", {
    get() {
      getterCalls += 1;
      return "user-001";
    },
    set() {
      setterCalls += 1;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(hostile, "status", {
    value: "active",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(hostile, "createdAt", {
    value: ACTIVE_CREATED_AT,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(hostile, "disabledAt", {
    value: null,
    enumerable: true,
    configurable: true,
    writable: true,
  });

  assertIdentityInvalid(hostile);
  assert.equal(getterCalls, 0);
  assert.equal(setterCalls, 0);

  const hostileProxy = new Proxy(activeInput(), {
    ownKeys() {
      throw new Error("hostile proxy");
    },
    get() {
      throw new Error("hostile proxy");
    },
  });
  assert.equal(isAuthIdentityActive(hostileProxy), false);
  assert.throws(
    () => createAuthIdentity(hostileProxy),
    (error) =>
      error &&
      error.name === "AuthIdentityValidationError" &&
      error.code === "AUTH_IDENTITY_INVALID",
  );
});

test("isAuthIdentityActive is true only for a valid active identity", () => {
  assert.equal(isAuthIdentityActive(createAuthIdentity(activeInput())), true);
  assert.equal(isAuthIdentityActive(createAuthIdentity(disabledInput())), false);
  assert.equal(isAuthIdentityActive(null), false);
  assert.equal(isAuthIdentityActive(undefined), false);
  assert.equal(isAuthIdentityActive("active"), false);
  assert.equal(isAuthIdentityActive(1), false);
  assert.equal(isAuthIdentityActive([]), false);
  assert.equal(isAuthIdentityActive(activeInput({ status: "disabled", disabledAt: null })), false);
});

test("identity checks ignore Object.prototype pollution", () => {
  const hadStatus = Object.hasOwn(Object.prototype, "status");
  const previousStatus = Object.prototype.status;
  const hadConstructor = Object.hasOwn(Object.prototype, "constructor");
  const previousConstructor = Object.prototype.constructor;

  Object.prototype.status = "active";
  Object.prototype.constructor = true;

  try {
    const incomplete = {
      userId: "user-001",
      createdAt: ACTIVE_CREATED_AT,
      disabledAt: null,
    };
    assertIdentityInvalid(incomplete);

    const identity = createAuthIdentity(activeInput());
    assert.equal(isAuthIdentityActive(identity), true);
    assert.equal(isAuthIdentityActive(disabledInput()), false);
  } finally {
    if (hadStatus) Object.prototype.status = previousStatus;
    else delete Object.prototype.status;
    if (hadConstructor) Object.prototype.constructor = previousConstructor;
    else delete Object.prototype.constructor;
  }
});

test("identity contract stays separate from AuthPrincipal and leaves matrices unchanged", () => {
  const identity = createAuthIdentity(activeInput());
  assert.equal(Object.hasOwn(identity, "role"), false);
  assert.equal(Object.hasOwn(identity, "tenantScope"), false);
  assert.equal(Object.hasOwn(identity, "permissions"), false);

  const principal = createAuthPrincipal({
    userId: identity.userId,
    role: "school_admin",
    tenantScope: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    permissions: ["users:read"],
  });
  assert.equal(can(principal, "users:read"), true);
  assert.equal(can(principal, "platform:manage"), false);

  let accepted = 0;
  let rejected = 0;
  const allowedByRole = Object.assign(Object.create(null), {
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
  });
  const scopeByRole = Object.assign(Object.create(null), {
    super_admin: { kind: "platform" },
    country_admin: { kind: "country", countryCode: "CD" },
    school_admin: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    principal: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    secretary: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    prefet: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    accountant: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    teacher: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    parent: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    student: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
  });

  for (let roleIndex = 0; roleIndex < CANONICAL_ROLES.length; roleIndex += 1) {
    const role = Reflect.get(CANONICAL_ROLES, String(roleIndex));
    createAuthPrincipal({
      userId: "user-matrix",
      role,
      tenantScope: Reflect.get(scopeByRole, role),
      permissions: [],
    });
    let roleAccepted = 0;
    for (let permissionIndex = 0; permissionIndex < AUTH_PERMISSION_CATALOG.length; permissionIndex += 1) {
      const permission = Reflect.get(AUTH_PERMISSION_CATALOG, String(permissionIndex));
      try {
        createAuthPrincipal({
          userId: "user-matrix",
          role,
          tenantScope: Reflect.get(scopeByRole, role),
          permissions: [permission],
        });
        accepted += 1;
        roleAccepted += 1;
      } catch {
        rejected += 1;
      }
    }
    assert.equal(roleAccepted, Reflect.get(allowedByRole, role));
  }

  assert.equal(accepted, 48);
  assert.equal(rejected, 102);
});
