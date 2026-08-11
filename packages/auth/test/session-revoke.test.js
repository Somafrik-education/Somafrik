import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_IDENTITY_STATUS,
  AUTH_PERMISSION_CATALOG,
  CANONICAL_ROLES,
  can,
  createAuthSession,
  isAuthSessionActive,
  revokeAuthSession,
} from "../src/index.js";

const ISSUED_AT = "2026-08-11T10:00:00.000Z";
const EXPIRES_AT = "2026-08-11T12:00:00.000Z";
const NOW_ACTIVE = "2026-08-11T11:00:00.000Z";
const REVOKED_AT = "2026-08-11T10:30:00.000Z";

function identityInput(overrides = {}) {
  return {
    userId: "user-001",
    status: AUTH_IDENTITY_STATUS.ACTIVE,
    createdAt: "2026-08-01T00:00:00.000Z",
    disabledAt: null,
    ...overrides,
  };
}

function principalInput(overrides = {}) {
  return {
    userId: "user-001",
    role: "school_admin",
    tenantScope: {
      kind: "school",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    permissions: ["schools:read", "users:read"],
    ...overrides,
  };
}

function sessionInput(overrides = {}) {
  return {
    sessionId: "session-001",
    identity: identityInput(),
    principal: principalInput(),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    revokedAt: null,
    ...overrides,
  };
}

function assertRevokeInvalid(session, revokedAt) {
  assert.throws(
    () => revokeAuthSession(session, revokedAt),
    (error) =>
      error &&
      error.name === "AuthSessionValidationError" &&
      error.code === "AUTH_SESSION_INVALID",
  );
}

test("revokes an active session into a new deeply immutable session", () => {
  const source = createAuthSession(sessionInput());
  assert.equal(isAuthSessionActive(source, NOW_ACTIVE), true);

  const revoked = revokeAuthSession(source, REVOKED_AT);

  assert.notEqual(revoked, source);
  assert.notEqual(revoked.identity, source.identity);
  assert.notEqual(revoked.principal, source.principal);
  assert.notEqual(revoked.principal.tenantScope, source.principal.tenantScope);
  assert.notEqual(revoked.principal.permissions, source.principal.permissions);

  assert.equal(source.revokedAt, null);
  assert.equal(revoked.revokedAt, REVOKED_AT);
  assert.equal(revoked.sessionId, source.sessionId);
  assert.equal(revoked.issuedAt, source.issuedAt);
  assert.equal(revoked.expiresAt, source.expiresAt);
  assert.deepEqual(revoked.identity, source.identity);
  assert.deepEqual(revoked.principal, source.principal);

  assert.equal(Object.isFrozen(revoked), true);
  assert.equal(Object.isFrozen(revoked.identity), true);
  assert.equal(Object.isFrozen(revoked.principal), true);
  assert.equal(Object.isFrozen(revoked.principal.permissions), true);

  assert.equal(isAuthSessionActive(revoked, NOW_ACTIVE), false);
  assert.equal(isAuthSessionActive(source, NOW_ACTIVE), true);

  assert.throws(() => {
    revoked.revokedAt = null;
  }, TypeError);
});

test("preserves the first revocation idempotently for the same timestamp", () => {
  const source = createAuthSession(sessionInput());
  const first = revokeAuthSession(source, REVOKED_AT);
  const second = revokeAuthSession(first, REVOKED_AT);

  assert.notEqual(second, first);
  assert.equal(second.revokedAt, REVOKED_AT);
  assert.deepEqual(second.identity, first.identity);
  assert.deepEqual(second.principal, first.principal);
  assert.equal(isAuthSessionActive(second, NOW_ACTIVE), false);
});

test("rejects a second revocation with a different timestamp", () => {
  const revoked = revokeAuthSession(createAuthSession(sessionInput()), REVOKED_AT);
  assertRevokeInvalid(revoked, "2026-08-11T10:45:00.000Z");
  assertRevokeInvalid(revoked, ISSUED_AT);
  assert.equal(revoked.revokedAt, REVOKED_AT);
});

test("rejects revokedAt before issuedAt and non-canonical timestamps", () => {
  const session = createAuthSession(sessionInput());
  assertRevokeInvalid(session, "2026-08-11T09:59:59.999Z");
  assertRevokeInvalid(session, "2026-08-11T10:30:00Z");
  assertRevokeInvalid(session, "2026-08-11T10:30:00.000+00:00");
  assertRevokeInvalid(session, null);
  assertRevokeInvalid(session, undefined);
  assertRevokeInvalid(session, 1);

  const atIssued = revokeAuthSession(session, ISSUED_AT);
  assert.equal(atIssued.revokedAt, ISSUED_AT);
  assert.equal(isAuthSessionActive(atIssued, NOW_ACTIVE), false);
});

test("rejects invalid or hostile session inputs without mutating sources", () => {
  const raw = sessionInput();
  assertRevokeInvalid(null, REVOKED_AT);
  assertRevokeInvalid(undefined, REVOKED_AT);
  assertRevokeInvalid("session", REVOKED_AT);
  assertRevokeInvalid(sessionInput({ principal: principalInput({ userId: "other" }) }), REVOKED_AT);
  assertRevokeInvalid(
    sessionInput({
      identity: identityInput({
        status: AUTH_IDENTITY_STATUS.DISABLED,
        disabledAt: "2026-08-02T00:00:00.000Z",
      }),
    }),
    REVOKED_AT,
  );

  let getterCalls = 0;
  const hostile = sessionInput();
  Object.defineProperty(hostile, "sessionId", {
    get() {
      getterCalls += 1;
      return "session-001";
    },
    enumerable: true,
    configurable: true,
  });
  assertRevokeInvalid(hostile, REVOKED_AT);
  assert.equal(getterCalls, 0);

  const hostileProxy = new Proxy(sessionInput(), {
    ownKeys() {
      throw new Error("hostile proxy");
    },
    get() {
      throw new Error("hostile proxy");
    },
  });
  assertRevokeInvalid(hostileProxy, REVOKED_AT);

  assert.equal(raw.revokedAt, null);
});

test("revocation ignores Object.prototype pollution", () => {
  const hadRevokedAt = Object.hasOwn(Object.prototype, "revokedAt");
  const previousRevokedAt = Object.prototype.revokedAt;
  const originalIncludes = Array.prototype.includes;

  Object.prototype.revokedAt = REVOKED_AT;
  Array.prototype.includes = () => true;

  try {
    const session = createAuthSession(sessionInput());
    assert.equal(session.revokedAt, null);
    const revoked = revokeAuthSession(session, REVOKED_AT);
    assert.equal(revoked.revokedAt, REVOKED_AT);
    assert.equal(isAuthSessionActive(revoked, NOW_ACTIVE), false);
    assertRevokeInvalid(revoked, "2026-08-11T11:00:00.000Z");
  } finally {
    Array.prototype.includes = originalIncludes;
    if (hadRevokedAt) Object.prototype.revokedAt = previousRevokedAt;
    else delete Object.prototype.revokedAt;
  }
});

test("revocation leaves permission matrix 48/102 unchanged", () => {
  const session = createAuthSession(sessionInput());
  const revoked = revokeAuthSession(session, REVOKED_AT);
  assert.equal(can(revoked.principal, "users:read"), true);
  assert.equal(can(revoked.principal, "platform:manage"), false);

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
    let roleAccepted = 0;
    for (
      let permissionIndex = 0;
      permissionIndex < AUTH_PERMISSION_CATALOG.length;
      permissionIndex += 1
    ) {
      const permission = Reflect.get(AUTH_PERMISSION_CATALOG, String(permissionIndex));
      try {
        createAuthSession(
          sessionInput({
            principal: {
              userId: "user-001",
              role,
              tenantScope: Reflect.get(scopeByRole, role),
              permissions: [permission],
            },
          }),
        );
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
