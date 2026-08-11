import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_IDENTITY_STATUS,
  AUTH_SESSION_ACCESS_TOKEN_STATUS,
  createAuthSession,
  createAuthSessionAccessToken,
  revokeAuthSession,
  revokeAuthSessionAccessToken,
  validateJwtBoundAuthSession,
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

function accessTokenInput(overrides = {}) {
  return {
    sessionId: "session-001",
    jti: "jti-001",
    status: AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    revokedAt: null,
    ...overrides,
  };
}

function cryptoToken(overrides = {}) {
  return {
    sub: "user-001",
    sid: "session-001",
    jti: "jti-001",
    ...overrides,
  };
}

async function assertBindingNull(crypto, session, accessToken, now = NOW_ACTIVE) {
  const result = await validateJwtBoundAuthSession(crypto, session, accessToken, now);
  assert.equal(result, null);
}

test("validateJwtBoundAuthSession returns JWT_BOUND_ACTIVE_SESSION material", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());
  const crypto = cryptoToken();

  const result = await validateJwtBoundAuthSession(crypto, session, accessToken, NOW_ACTIVE);

  assert.equal(result.sub, "user-001");
  assert.equal(result.sid, "session-001");
  assert.equal(result.jti, "jti-001");
  assert.deepEqual(result.principal, session.principal);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.principal), true);
  assert.notEqual(result, crypto);
  assert.notEqual(result.principal, session);
});

test("rejects hostile cryptographicallyAdmissibleToken shapes", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());

  await assertBindingNull(null, session, accessToken);
  await assertBindingNull([], session, accessToken);
  await assertBindingNull("token", session, accessToken);
  await assertBindingNull({ sub: "user-001", sid: "session-001" }, session, accessToken);
  await assertBindingNull(
    { sub: "user-001", sid: "session-001", jti: "jti-001", extra: true },
    session,
    accessToken,
  );
  await assertBindingNull(
    { sub: 1, sid: "session-001", jti: "jti-001" },
    session,
    accessToken,
  );

  const withSymbol = { sub: "user-001", sid: "session-001", jti: "jti-001" };
  Object.defineProperty(withSymbol, Symbol("x"), { value: 1 });
  await assertBindingNull(withSymbol, session, accessToken);

  const withAccessor = {};
  Object.defineProperty(withAccessor, "sub", {
    get() {
      return "user-001";
    },
    enumerable: true,
  });
  Object.assign(withAccessor, { sid: "session-001", jti: "jti-001" });
  await assertBindingNull(withAccessor, session, accessToken);
});

test("rejects inactive, revoked, or invalid sessions", async () => {
  const accessToken = createAuthSessionAccessToken(accessTokenInput());
  const crypto = cryptoToken();

  await assertBindingNull(crypto, sessionInput(), accessToken, "2026-08-11T09:00:00.000Z");
  await assertBindingNull(crypto, sessionInput(), accessToken, EXPIRES_AT);
  await assertBindingNull(crypto, null, accessToken);
  await assertBindingNull(crypto, { ...sessionInput(), extra: true }, accessToken);

  const revokedSession = revokeAuthSession(createAuthSession(sessionInput()), REVOKED_AT);
  await assertBindingNull(crypto, revokedSession, accessToken);
});

test("rejects inactive, revoked, or invalid AuthSessionAccessToken", async () => {
  const session = createAuthSession(sessionInput());
  const crypto = cryptoToken();

  await assertBindingNull(crypto, session, null);
  await assertBindingNull(crypto, session, { ...accessTokenInput(), jti: "bad/jti" });
  await assertBindingNull(crypto, session, accessTokenInput(), "2026-08-11T09:00:00.000Z");
  await assertBindingNull(crypto, session, accessTokenInput(), EXPIRES_AT);

  const revoked = revokeAuthSessionAccessToken(
    createAuthSessionAccessToken(accessTokenInput()),
    REVOKED_AT,
  );
  await assertBindingNull(crypto, session, revoked);

  await assertBindingNull(
    crypto,
    session,
    accessTokenInput({
      status: AUTH_SESSION_ACCESS_TOKEN_STATUS.REVOKED,
      revokedAt: REVOKED_AT,
    }),
  );
});

test("rejects sid / sub / jti / sessionId binding mismatches", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());

  await assertBindingNull(cryptoToken({ sid: "other-session" }), session, accessToken);
  await assertBindingNull(cryptoToken({ sub: "other-user" }), session, accessToken);
  await assertBindingNull(cryptoToken({ jti: "other-jti" }), session, accessToken);
  await assertBindingNull(
    cryptoToken(),
    session,
    createAuthSessionAccessToken(accessTokenInput({ sessionId: "other-session" })),
  );
  await assertBindingNull(
    cryptoToken({ jti: "jti-002" }),
    session,
    createAuthSessionAccessToken(accessTokenInput({ jti: "jti-001" })),
  );
});

test("returns principal exclusively from the validated session", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());
  const result = await validateJwtBoundAuthSession(
    cryptoToken(),
    session,
    accessToken,
    NOW_ACTIVE,
  );

  assert.equal(result.principal.userId, "user-001");
  assert.equal(result.principal.role, "school_admin");
  assert.deepEqual(result.principal.permissions, ["schools:read", "users:read"]);
  assert.equal(Object.keys(result).sort().join(","), "jti,principal,sid,sub");
});

test("never throws or rejects for hostile evaluation time or inputs", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());

  assert.equal(
    await validateJwtBoundAuthSession(cryptoToken(), session, accessToken, "bad"),
    null,
  );
  assert.equal(
    await validateJwtBoundAuthSession(cryptoToken(), session, accessToken, null),
    null,
  );
  assert.equal(await validateJwtBoundAuthSession(undefined, undefined, undefined, undefined), null);
});

test("exports validateJwtBoundAuthSession as an async function", async () => {
  assert.equal(typeof validateJwtBoundAuthSession, "function");
  const pending = validateJwtBoundAuthSession(
    cryptoToken(),
    createAuthSession(sessionInput()),
    createAuthSessionAccessToken(accessTokenInput()),
    NOW_ACTIVE,
  );
  assert.equal(typeof pending.then, "function");
  const result = await pending;
  assert.equal(result.jti, "jti-001");
});
