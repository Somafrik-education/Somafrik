import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_IDENTITY_STATUS,
  AUTH_PERMISSION_CATALOG,
  AUTHORIZATION_DECISION,
  CANONICAL_ROLES,
  can,
  createAuthSession,
  evaluateSessionAuthorization,
  revokeAuthSession,
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

test("exposes the exact immutable authorization decision catalog", () => {
  assert.deepEqual(AUTHORIZATION_DECISION, {
    AUTHORIZED: "authorized",
    UNAUTHENTICATED: "unauthenticated",
    FORBIDDEN: "forbidden",
  });
  assert.deepEqual(Object.keys(AUTHORIZATION_DECISION), [
    "AUTHORIZED",
    "UNAUTHENTICATED",
    "FORBIDDEN",
  ]);
  assert.equal(Object.isFrozen(AUTHORIZATION_DECISION), true);
  assert.throws(() => {
    AUTHORIZATION_DECISION.AUTHORIZED = "ok";
  }, TypeError);
});

test("returns AUTHORIZED for an active session carrying an allowed permission", () => {
  const session = createAuthSession(sessionInput());
  assert.equal(
    evaluateSessionAuthorization(session, "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.AUTHORIZED,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "schools:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.AUTHORIZED,
  );
  assert.equal(session.revokedAt, null);
  assert.deepEqual(session.principal.permissions, ["schools:read", "users:read"]);
});

test("returns FORBIDDEN when the active session does not carry the permission", () => {
  const session = createAuthSession(sessionInput());
  assert.equal(
    evaluateSessionAuthorization(session, "users:update", NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "roles:assign", NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(can(session.principal, "users:update"), false);
});

test("returns FORBIDDEN for invalid or out-of-catalog permissions on an active session", () => {
  const session = createAuthSession(sessionInput());
  assert.equal(
    evaluateSessionAuthorization(session, "notes:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "platform:manage", NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "*", NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "Users:Read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "", NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(
    evaluateSessionAuthorization(session, null, NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
  assert.equal(
    evaluateSessionAuthorization(session, undefined, NOW_ACTIVE),
    AUTHORIZATION_DECISION.FORBIDDEN,
  );
});

test("returns UNAUTHENTICATED for revoked expired future or inactive sessions", () => {
  const active = createAuthSession(sessionInput());
  const revoked = revokeAuthSession(active, "2026-08-11T10:30:00.000Z");

  assert.equal(
    evaluateSessionAuthorization(revoked, "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(active, "users:read", EXPIRES_AT),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(active, "users:read", "2026-08-11T09:59:59.999Z"),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(active, "users:read", "2026-08-11T12:00:00.001Z"),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
});

test("returns UNAUTHENTICATED for invalid now values", () => {
  const session = createAuthSession(sessionInput());
  assert.equal(
    evaluateSessionAuthorization(session, "users:read", "2026-08-11T11:00:00Z"),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "users:read", "2026-08-11T11:00:00.000+00:00"),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "users:read", null),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "users:read", undefined),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(session, "users:read", 1),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
});

test("returns UNAUTHENTICATED for invalid identity principal or session shapes", () => {
  assert.equal(
    evaluateSessionAuthorization(null, "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(undefined, "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization("session", "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(
      sessionInput({
        identity: identityInput({
          status: AUTH_IDENTITY_STATUS.DISABLED,
          disabledAt: "2026-08-02T00:00:00.000Z",
        }),
      }),
      "users:read",
      NOW_ACTIVE,
    ),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(
      sessionInput({
        principal: principalInput({ userId: "other-user" }),
      }),
      "users:read",
      NOW_ACTIVE,
    ),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(
    evaluateSessionAuthorization(
      sessionInput({
        principal: principalInput({ permissions: ["platform:manage"] }),
      }),
      "platform:manage",
      NOW_ACTIVE,
    ),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
});

test("never throws on hostile inputs and never mutates the session", () => {
  const session = createAuthSession(sessionInput());
  const snapshot = {
    sessionId: session.sessionId,
    revokedAt: session.revokedAt,
    permissions: [...session.principal.permissions],
  };

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
  assert.equal(
    evaluateSessionAuthorization(hostile, "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );
  assert.equal(getterCalls, 0);

  const hostileProxy = new Proxy(sessionInput(), {
    ownKeys() {
      throw new Error("hostile proxy");
    },
    get() {
      throw new Error("hostile proxy");
    },
  });
  assert.equal(
    evaluateSessionAuthorization(hostileProxy, "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.UNAUTHENTICATED,
  );

  assert.equal(
    evaluateSessionAuthorization(session, "users:read", NOW_ACTIVE),
    AUTHORIZATION_DECISION.AUTHORIZED,
  );
  assert.equal(session.sessionId, snapshot.sessionId);
  assert.equal(session.revokedAt, snapshot.revokedAt);
  assert.deepEqual(session.principal.permissions, snapshot.permissions);
});

test("authorization decisions ignore prototype pollution", () => {
  const hadAuthorized = Object.hasOwn(Object.prototype, "AUTHORIZED");
  const previousAuthorized = Object.prototype.AUTHORIZED;
  const originalIncludes = Array.prototype.includes;

  Object.prototype.AUTHORIZED = "authorized";
  Array.prototype.includes = () => true;

  try {
    const session = createAuthSession(
      sessionInput({
        principal: principalInput({ permissions: ["users:read"] }),
      }),
    );
    assert.equal(
      evaluateSessionAuthorization(session, "users:read", NOW_ACTIVE),
      AUTHORIZATION_DECISION.AUTHORIZED,
    );
    assert.equal(
      evaluateSessionAuthorization(session, "users:update", NOW_ACTIVE),
      AUTHORIZATION_DECISION.FORBIDDEN,
    );
    assert.equal(
      evaluateSessionAuthorization(session, "users:read", "bad-now"),
      AUTHORIZATION_DECISION.UNAUTHENTICATED,
    );
  } finally {
    Array.prototype.includes = originalIncludes;
    if (hadAuthorized) Object.prototype.AUTHORIZED = previousAuthorized;
    else delete Object.prototype.AUTHORIZED;
  }
});

test("authorization contract leaves matrix 48/102 unchanged", () => {
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
      const input = sessionInput({
        principal: {
          userId: "user-001",
          role,
          tenantScope: Reflect.get(scopeByRole, role),
          permissions: [permission],
        },
      });
      try {
        const session = createAuthSession(input);
        assert.equal(
          evaluateSessionAuthorization(session, permission, NOW_ACTIVE),
          AUTHORIZATION_DECISION.AUTHORIZED,
        );
        accepted += 1;
        roleAccepted += 1;
      } catch {
        assert.equal(
          evaluateSessionAuthorization(input, permission, NOW_ACTIVE),
          AUTHORIZATION_DECISION.UNAUTHENTICATED,
        );
        rejected += 1;
      }
    }
    assert.equal(roleAccepted, Reflect.get(allowedByRole, role));
  }

  assert.equal(accepted, 48);
  assert.equal(rejected, 102);
});
