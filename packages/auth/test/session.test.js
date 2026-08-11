import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_IDENTITY_STATUS,
  AUTH_PERMISSION_CATALOG,
  CANONICAL_ROLES,
  can,
  createAuthIdentity,
  createAuthPrincipal,
  createAuthSession,
  isAuthSessionActive,
} from "../src/index.js";

const ISSUED_AT = "2026-08-11T10:00:00.000Z";
const EXPIRES_AT = "2026-08-11T12:00:00.000Z";
const NOW_ACTIVE = "2026-08-11T11:00:00.000Z";

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

function assertSessionInvalid(input, now = NOW_ACTIVE) {
  assert.throws(
    () => createAuthSession(input),
    (error) =>
      error &&
      error.name === "AuthSessionValidationError" &&
      error.code === "AUTH_SESSION_INVALID",
  );
  assert.equal(isAuthSessionActive(input, now), false);
}

test("creates a deeply immutable session distinct from all source references", () => {
  const sourceIdentity = identityInput();
  const sourcePrincipal = principalInput();
  const sourcePermissions = sourcePrincipal.permissions;
  const sourceTenantScope = sourcePrincipal.tenantScope;
  const source = sessionInput({
    identity: sourceIdentity,
    principal: sourcePrincipal,
  });

  const session = createAuthSession(source);

  assert.notEqual(session, source);
  assert.notEqual(session.identity, sourceIdentity);
  assert.notEqual(session.principal, sourcePrincipal);
  assert.notEqual(session.principal.tenantScope, sourceTenantScope);
  assert.notEqual(session.principal.permissions, sourcePermissions);

  assert.deepEqual(session, {
    sessionId: "session-001",
    identity: {
      userId: "user-001",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      disabledAt: null,
    },
    principal: {
      userId: "user-001",
      role: "school_admin",
      tenantScope: {
        kind: "school",
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
      },
      permissions: ["schools:read", "users:read"],
    },
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    revokedAt: null,
  });

  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(session.identity), true);
  assert.equal(Object.isFrozen(session.principal), true);
  assert.equal(Object.isFrozen(session.principal.tenantScope), true);
  assert.equal(Object.isFrozen(session.principal.permissions), true);

  source.sessionId = "mutated";
  sourceIdentity.userId = "other";
  sourcePrincipal.role = "teacher";
  sourcePermissions.push("users:disable");
  sourceTenantScope.countryCode = "XX";

  assert.equal(session.sessionId, "session-001");
  assert.equal(session.identity.userId, "user-001");
  assert.equal(session.principal.role, "school_admin");
  assert.deepEqual(session.principal.permissions, ["schools:read", "users:read"]);
  assert.equal(session.principal.tenantScope.countryCode, "CD");

  assert.throws(() => {
    session.sessionId = "x";
  }, TypeError);
  assert.throws(() => {
    session.principal.permissions.push("roles:assign");
  }, TypeError);
});

test("accepts an active identity with a valid principal sharing the same userId", () => {
  const session = createAuthSession(sessionInput());
  assert.equal(session.identity.status, "active");
  assert.equal(session.principal.userId, session.identity.userId);
  assert.equal(isAuthSessionActive(session, NOW_ACTIVE), true);
  assert.equal(isAuthSessionActive(session, ISSUED_AT), true);
  assert.equal(isAuthSessionActive(session, "2026-08-11T11:59:59.999Z"), true);
  assert.equal(isAuthSessionActive(session, EXPIRES_AT), false);
});

test("rejects a disabled identity even when structurally complete", () => {
  assertSessionInvalid(
    sessionInput({
      identity: identityInput({
        status: AUTH_IDENTITY_STATUS.DISABLED,
        disabledAt: "2026-08-02T00:00:00.000Z",
      }),
    }),
  );
});

test("rejects mismatched userId values without normalization", () => {
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({ userId: "User-001" }),
    }),
  );
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({ userId: "user-001 " }),
    }),
  );
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({ userId: "user-002" }),
    }),
  );
});

test("rejects invalid principal role tenant or permission combinations", () => {
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({ role: "global_admin" }),
    }),
  );
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({
        role: "teacher",
        permissions: ["users:read"],
      }),
    }),
  );
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({
        tenantScope: { kind: "platform" },
      }),
    }),
  );
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({ permissions: ["notes:read"] }),
    }),
  );
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({ permissions: ["platform:manage"] }),
    }),
  );
  assertSessionInvalid(
    sessionInput({
      principal: principalInput({ permissions: ["users:read", "users:read"] }),
    }),
  );
});

test("rejects invalid sessionId values without normalization", () => {
  assertSessionInvalid(sessionInput({ sessionId: "" }));
  assertSessionInvalid(sessionInput({ sessionId: "   " }));
  assertSessionInvalid(sessionInput({ sessionId: " session-001" }));
  assertSessionInvalid(sessionInput({ sessionId: "session-001 " }));
  assertSessionInvalid(sessionInput({ sessionId: "\u00A0session-001" }));
  assertSessionInvalid(sessionInput({ sessionId: "session-001\u00A0" }));
  assertSessionInvalid(sessionInput({ sessionId: "session\u008501" }));
  assertSessionInvalid(sessionInput({ sessionId: "session\u009F01" }));
  assertSessionInvalid(sessionInput({ sessionId: "a".repeat(129) }));
  assertSessionInvalid(sessionInput({ sessionId: 42 }));

  const accepted = createAuthSession(sessionInput({ sessionId: "a".repeat(128) }));
  assert.equal(accepted.sessionId.length, 128);
  assert.equal(accepted.sessionId, "a".repeat(128));
});

test("rejects invalid or non-canonical timestamps and expiresAt ordering", () => {
  assertSessionInvalid(sessionInput({ issuedAt: "2026-08-11T10:00:00Z" }));
  assertSessionInvalid(sessionInput({ issuedAt: "2026-08-11T10:00:00.000+00:00" }));
  assertSessionInvalid(sessionInput({ expiresAt: "2026-08-11T12:00:00Z" }));
  assertSessionInvalid(sessionInput({ expiresAt: ISSUED_AT }));
  assertSessionInvalid(
    sessionInput({
      issuedAt: "2026-08-11T12:00:00.000Z",
      expiresAt: "2026-08-11T11:00:00.000Z",
    }),
  );
  assertSessionInvalid(sessionInput({ revokedAt: "2026-08-11T09:59:59.999Z" }));

  const revokedAfterExpiry = createAuthSession(
    sessionInput({
      revokedAt: "2026-08-11T13:00:00.000Z",
    }),
  );
  assert.equal(revokedAfterExpiry.revokedAt, "2026-08-11T13:00:00.000Z");
  assert.equal(isAuthSessionActive(revokedAfterExpiry, NOW_ACTIVE), false);
});

test("isAuthSessionActive enforces exclusive expiry and mandatory canonical now", () => {
  const session = createAuthSession(sessionInput());

  assert.equal(isAuthSessionActive(session, "2026-08-11T09:59:59.999Z"), false);
  assert.equal(isAuthSessionActive(session, ISSUED_AT), true);
  assert.equal(isAuthSessionActive(session, "2026-08-11T11:59:59.999Z"), true);
  assert.equal(isAuthSessionActive(session, EXPIRES_AT), false);
  assert.equal(isAuthSessionActive(session, "2026-08-11T12:00:00.001Z"), false);

  assert.equal(isAuthSessionActive(session, "2026-08-11T11:00:00Z"), false);
  assert.equal(isAuthSessionActive(session, "2026-08-11T11:00:00.000+00:00"), false);
  assert.equal(isAuthSessionActive(session, null), false);
  assert.equal(isAuthSessionActive(session, undefined), false);
  assert.equal(isAuthSessionActive(session, 1), false);

  const revoked = createAuthSession(sessionInput({ revokedAt: NOW_ACTIVE }));
  assert.equal(isAuthSessionActive(revoked, NOW_ACTIVE), false);
});

test("rejects missing extra symbol inherited properties getters and hostile proxies", () => {
  const missing = {
    sessionId: "session-001",
    identity: identityInput(),
    principal: principalInput(),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  };
  assertSessionInvalid(missing);

  assertSessionInvalid(sessionInput({ token: "secret" }));

  const withSymbol = sessionInput();
  withSymbol[Symbol("extra")] = "nope";
  assertSessionInvalid(withSymbol);

  const inherited = {
    sessionId: "session-001",
    identity: identityInput(),
    principal: principalInput(),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  };
  Object.setPrototypeOf(inherited, { revokedAt: null });
  assertSessionInvalid(inherited);

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
  assertSessionInvalid(hostile);
  assert.equal(getterCalls, 0);

  const hostileProxy = new Proxy(sessionInput(), {
    ownKeys() {
      throw new Error("hostile proxy");
    },
    get() {
      throw new Error("hostile proxy");
    },
  });
  assert.equal(isAuthSessionActive(hostileProxy, NOW_ACTIVE), false);
  assert.throws(
    () => createAuthSession(hostileProxy),
    (error) =>
      error &&
      error.name === "AuthSessionValidationError" &&
      error.code === "AUTH_SESSION_INVALID",
  );

  assert.equal(isAuthSessionActive(null, NOW_ACTIVE), false);
  assert.equal(isAuthSessionActive(undefined, NOW_ACTIVE), false);
  assert.equal(isAuthSessionActive("session", NOW_ACTIVE), false);
});

test("session checks ignore Object.prototype pollution", () => {
  const hadRevokedAt = Object.hasOwn(Object.prototype, "revokedAt");
  const previousRevokedAt = Object.prototype.revokedAt;
  const hadConstructor = Object.hasOwn(Object.prototype, "constructor");
  const previousConstructor = Object.prototype.constructor;

  Object.prototype.revokedAt = null;
  Object.prototype.constructor = true;

  try {
    const incomplete = {
      sessionId: "session-001",
      identity: identityInput(),
      principal: principalInput(),
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    };
    assertSessionInvalid(incomplete);

    const session = createAuthSession(sessionInput());
    assert.equal(isAuthSessionActive(session, NOW_ACTIVE), true);
  } finally {
    if (hadRevokedAt) Object.prototype.revokedAt = previousRevokedAt;
    else delete Object.prototype.revokedAt;
    if (hadConstructor) Object.prototype.constructor = previousConstructor;
    else delete Object.prototype.constructor;
  }
});

test("session contract leaves identity principal APIs and matrix 48/102 unchanged", () => {
  const identity = createAuthIdentity(identityInput());
  const principal = createAuthPrincipal(principalInput({ permissions: ["users:read"] }));
  assert.equal(can(principal, "users:read"), true);
  assert.equal(can(principal, "platform:manage"), false);

  const session = createAuthSession(
    sessionInput({
      identity,
      principal: principalInput({ permissions: ["users:read"] }),
    }),
  );
  assert.equal(session.identity.userId, identity.userId);
  assert.notEqual(session.identity, identity);

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
