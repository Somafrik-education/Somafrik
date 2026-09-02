import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_SESSION_ACCESS_TOKEN_STATUS,
  createAuthSessionAccessToken,
  isAuthSessionAccessTokenActive,
} from "../src/index.js";

const ISSUED_AT = "2026-08-11T10:00:00.000Z";
const EXPIRES_AT = "2026-08-11T12:00:00.000Z";
const NOW_ACTIVE = "2026-08-11T11:00:00.000Z";
const REVOKED_AT = "2026-08-11T10:30:00.000Z";

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

function assertAccessTokenInvalid(input, now = NOW_ACTIVE) {
  assert.throws(
    () => createAuthSessionAccessToken(input),
    (error) =>
      error &&
      error.name === "AuthSessionAccessTokenValidationError" &&
      error.code === "AUTH_SESSION_ACCESS_TOKEN_INVALID",
  );
  assert.equal(isAuthSessionAccessTokenActive(input, now), false);
}

test("creates a frozen active AuthSessionAccessToken distinct from the source", () => {
  const source = accessTokenInput();
  const token = createAuthSessionAccessToken(source);

  assert.notEqual(token, source);
  assert.deepEqual(token, {
    sessionId: "session-001",
    jti: "jti-001",
    status: "active",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    revokedAt: null,
  });
  assert.equal(Object.isFrozen(token), true);

  source.jti = "mutated";
  assert.equal(token.jti, "jti-001");
  assert.throws(() => {
    token.jti = "x";
  }, TypeError);
});

test("isAuthSessionAccessTokenActive accepts only the open temporal window", () => {
  const token = createAuthSessionAccessToken(accessTokenInput());

  assert.equal(isAuthSessionAccessTokenActive(token, ISSUED_AT), true);
  assert.equal(isAuthSessionAccessTokenActive(token, NOW_ACTIVE), true);
  assert.equal(isAuthSessionAccessTokenActive(token, "2026-08-11T09:59:59.999Z"), false);
  assert.equal(isAuthSessionAccessTokenActive(token, EXPIRES_AT), false);
  assert.equal(isAuthSessionAccessTokenActive(token, "2026-08-11T12:00:00.001Z"), false);
});

test("rejects hostile jti values with the V2.1o / V2.1z alphabet", () => {
  assertAccessTokenInvalid(accessTokenInput({ jti: "" }));
  assertAccessTokenInvalid(accessTokenInput({ jti: "a".repeat(129) }));
  assertAccessTokenInvalid(accessTokenInput({ jti: "bad/jti" }));
  assertAccessTokenInvalid(accessTokenInput({ jti: "bad\\jti" }));
  assertAccessTokenInvalid(accessTokenInput({ jti: "bad jti" }));
  assertAccessTokenInvalid(accessTokenInput({ jti: "jti\u00e9" }));
  assertAccessTokenInvalid(accessTokenInput({ jti: "jti\n" }));
  assertAccessTokenInvalid(accessTokenInput({ jti: 42 }));
  assertAccessTokenInvalid(accessTokenInput({ jti: null }));
});

test("accepts jti values in the canonical ASCII alphabet including length 128", () => {
  const exact128 = "a".repeat(128);
  const token = createAuthSessionAccessToken(accessTokenInput({ jti: exact128 }));
  assert.equal(token.jti, exact128);
  assert.equal(token.jti.length, 128);
  assert.equal(isAuthSessionAccessTokenActive(token, NOW_ACTIVE), true);

  const mixed = createAuthSessionAccessToken(
    accessTokenInput({ jti: "Abc_012.:-XYZ" }),
  );
  assert.equal(mixed.jti, "Abc_012.:-XYZ");
  assert.equal(isAuthSessionAccessTokenActive(mixed, NOW_ACTIVE), true);
});

test("rejects impossible timestamps that only look syntactically canonical", () => {
  assertAccessTokenInvalid(accessTokenInput({ issuedAt: "2026-02-30T10:00:00.000Z" }));
  assertAccessTokenInvalid(accessTokenInput({ expiresAt: "2026-13-01T10:00:00.000Z" }));
  assertAccessTokenInvalid(accessTokenInput({ issuedAt: "2026-04-31T10:00:00.000Z" }));
  assertAccessTokenInvalid(
    accessTokenInput({
      status: AUTH_SESSION_ACCESS_TOKEN_STATUS.REVOKED,
      revokedAt: "2026-02-30T10:30:00.000Z",
    }),
  );
});

test("rejects inherited prototype fields and missing own data properties", () => {
  const inherited = {
    sessionId: "session-001",
    jti: "jti-001",
    status: AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  };
  Object.setPrototypeOf(inherited, { revokedAt: null });
  assertAccessTokenInvalid(inherited);

  const inheritedOnly = Object.create({
    sessionId: "session-001",
    jti: "jti-001",
    status: AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    revokedAt: null,
  });
  assertAccessTokenInvalid(inheritedOnly);
});

test("rejects transparent and hostile proxies without invoking traps", () => {
  const transparent = new Proxy(accessTokenInput(), {});
  assertAccessTokenInvalid(transparent);

  let trapCalls = 0;
  const hostileProxy = new Proxy(accessTokenInput(), {
    get() {
      trapCalls += 1;
      throw new Error("hostile proxy");
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error("hostile proxy");
    },
  });
  assertAccessTokenInvalid(hostileProxy);
  assert.equal(trapCalls, 0);
  assert.equal(isAuthSessionAccessTokenActive(hostileProxy, NOW_ACTIVE), false);
});

test("rejects hostile sessionId and timestamp shapes", () => {
  assertAccessTokenInvalid(accessTokenInput({ sessionId: "" }));
  assertAccessTokenInvalid(accessTokenInput({ sessionId: " ".repeat(1) + "session" }));
  assertAccessTokenInvalid(accessTokenInput({ sessionId: "session\u0000" }));
  assertAccessTokenInvalid(accessTokenInput({ issuedAt: "2026-08-11T10:00:00Z" }));
  assertAccessTokenInvalid(accessTokenInput({ expiresAt: ISSUED_AT }));
  assertAccessTokenInvalid(accessTokenInput({ expiresAt: "2026-08-11T09:00:00.000Z" }));
  assertAccessTokenInvalid(accessTokenInput({ status: "ACTIVE" }));
  assertAccessTokenInvalid(accessTokenInput({ status: "disabled" }));
  assertAccessTokenInvalid(
    accessTokenInput({
      status: AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE,
      revokedAt: REVOKED_AT,
    }),
  );
  assertAccessTokenInvalid(
    accessTokenInput({
      status: AUTH_SESSION_ACCESS_TOKEN_STATUS.REVOKED,
      revokedAt: null,
    }),
  );
  assertAccessTokenInvalid(
    accessTokenInput({
      status: AUTH_SESSION_ACCESS_TOKEN_STATUS.REVOKED,
      revokedAt: "2026-08-11T09:00:00.000Z",
    }),
  );
  assertAccessTokenInvalid({ ...accessTokenInput(), extra: true });
  assertAccessTokenInvalid(null);
  assertAccessTokenInvalid([]);
  assertAccessTokenInvalid("token");
});

test("rejects missing fields and accessor properties", () => {
  const missing = accessTokenInput();
  delete missing.jti;
  assertAccessTokenInvalid(missing);

  const withAccessor = {};
  Object.defineProperty(withAccessor, "sessionId", {
    get() {
      return "session-001";
    },
    enumerable: true,
  });
  Object.assign(withAccessor, {
    jti: "jti-001",
    status: AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    revokedAt: null,
  });
  assertAccessTokenInvalid(withAccessor);
});

test("rejects non-canonical evaluation times without throwing", () => {
  const token = createAuthSessionAccessToken(accessTokenInput());
  assert.equal(isAuthSessionAccessTokenActive(token, "2026-08-11T11:00:00Z"), false);
  assert.equal(isAuthSessionAccessTokenActive(token, 1), false);
  assert.equal(isAuthSessionAccessTokenActive(token, null), false);
});

test("treats a structurally revoked token as inactive without a revoke API", () => {
  const token = createAuthSessionAccessToken(
    accessTokenInput({
      status: AUTH_SESSION_ACCESS_TOKEN_STATUS.REVOKED,
      revokedAt: REVOKED_AT,
    }),
  );
  assert.equal(token.status, "revoked");
  assert.equal(token.revokedAt, REVOKED_AT);
  assert.equal(isAuthSessionAccessTokenActive(token, NOW_ACTIVE), false);
});

test("does not export revokeAuthSessionAccessToken", async () => {
  const indexModule = await import("../src/index.js");
  assert.equal(Object.hasOwn(indexModule, "revokeAuthSessionAccessToken"), false);
  assert.equal(typeof indexModule.revokeAuthSessionAccessToken, "undefined");
});
