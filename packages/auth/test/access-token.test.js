import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_SESSION_ACCESS_TOKEN_STATUS,
  createAuthSessionAccessToken,
  isAuthSessionAccessTokenActive,
  revokeAuthSessionAccessToken,
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

test("accepts jti values in the canonical ASCII alphabet", () => {
  const token = createAuthSessionAccessToken(
    accessTokenInput({ jti: "Abc_012.:-XYZ" }),
  );
  assert.equal(token.jti, "Abc_012.:-XYZ");
  assert.equal(isAuthSessionAccessTokenActive(token, NOW_ACTIVE), true);
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

test("revokes an active token into a new frozen revoked token", () => {
  const source = createAuthSessionAccessToken(accessTokenInput());
  assert.equal(isAuthSessionAccessTokenActive(source, NOW_ACTIVE), true);

  const revoked = revokeAuthSessionAccessToken(source, REVOKED_AT);

  assert.notEqual(revoked, source);
  assert.equal(source.status, "active");
  assert.equal(source.revokedAt, null);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedAt, REVOKED_AT);
  assert.equal(revoked.jti, source.jti);
  assert.equal(Object.isFrozen(revoked), true);
  assert.equal(isAuthSessionAccessTokenActive(revoked, NOW_ACTIVE), false);
});

test("preserves idempotent revocation for the same timestamp", () => {
  const source = createAuthSessionAccessToken(accessTokenInput());
  const first = revokeAuthSessionAccessToken(source, REVOKED_AT);
  const second = revokeAuthSessionAccessToken(first, REVOKED_AT);

  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});

test("rejects a second revocation with a different timestamp", () => {
  const source = createAuthSessionAccessToken(accessTokenInput());
  const first = revokeAuthSessionAccessToken(source, REVOKED_AT);

  assert.throws(
    () => revokeAuthSessionAccessToken(first, "2026-08-11T10:45:00.000Z"),
    (error) =>
      error &&
      error.name === "AuthSessionAccessTokenValidationError" &&
      error.code === "AUTH_SESSION_ACCESS_TOKEN_INVALID",
  );
});

test("rejects revoke with revokedAt before issuedAt", () => {
  const source = createAuthSessionAccessToken(accessTokenInput());
  assert.throws(
    () => revokeAuthSessionAccessToken(source, "2026-08-11T09:00:00.000Z"),
    (error) =>
      error &&
      error.name === "AuthSessionAccessTokenValidationError" &&
      error.code === "AUTH_SESSION_ACCESS_TOKEN_INVALID",
  );
});

test("creates a revoked token when status and revokedAt are coherent", () => {
  const token = createAuthSessionAccessToken(
    accessTokenInput({
      status: AUTH_SESSION_ACCESS_TOKEN_STATUS.REVOKED,
      revokedAt: REVOKED_AT,
    }),
  );
  assert.equal(token.status, "revoked");
  assert.equal(isAuthSessionAccessTokenActive(token, NOW_ACTIVE), false);
});
