import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_IDENTITY_STATUS,
  AUTH_SESSION_ACCESS_TOKEN_STATUS,
  createAuthSession,
  createAuthSessionAccessToken,
  revokeAuthSession,
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

test("rejects cryptographicallyAdmissibleToken ids outside ^[A-Za-z0-9._:-]{1,128}$", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());

  const hostileIds = [
    "",
    "a".repeat(129),
    "bad/id",
    "bad\\id",
    "bad id",
    "id\u00e9",
    "id\n",
    "id\u0000",
    " id",
    "id ",
  ];

  for (const hostile of hostileIds) {
    await assertBindingNull(cryptoToken({ sub: hostile }), session, accessToken);
    await assertBindingNull(cryptoToken({ sid: hostile }), session, accessToken);
    await assertBindingNull(cryptoToken({ jti: hostile }), session, accessToken);
  }
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

test("returns principal exclusively from the validated session with matching userId", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());
  const result = await validateJwtBoundAuthSession(
    cryptoToken(),
    session,
    accessToken,
    NOW_ACTIVE,
  );

  assert.equal(result.principal.userId, "user-001");
  assert.equal(result.principal.userId, result.sub);
  assert.equal(result.principal.userId, session.identity.userId);
  assert.equal(result.principal.userId, session.principal.userId);
  assert.equal(result.principal.role, "school_admin");
  assert.deepEqual(result.principal.permissions, ["schools:read", "users:read"]);
  assert.equal(Object.keys(result).sort().join(","), "jti,principal,sid,sub");
});

test("rejects transparent and hostile proxies on every object input", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());
  const crypto = cryptoToken();

  await assertBindingNull(new Proxy(crypto, {}), session, accessToken);
  await assertBindingNull(crypto, new Proxy(session, {}), accessToken);
  await assertBindingNull(crypto, session, new Proxy(accessToken, {}));

  let trapCalls = 0;
  const hostileHandler = {
    get() {
      trapCalls += 1;
      throw new Error("hostile proxy");
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error("hostile proxy");
    },
  };

  await assertBindingNull(new Proxy(crypto, hostileHandler), session, accessToken);
  await assertBindingNull(crypto, new Proxy(session, hostileHandler), accessToken);
  await assertBindingNull(crypto, session, new Proxy(accessToken, hostileHandler));
  assert.equal(trapCalls, 0);
});

test("does not mutate any of the four binding inputs", async () => {
  const crypto = cryptoToken();
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());
  const now = NOW_ACTIVE;

  const cryptoBefore = structuredClone(crypto);
  const sessionBefore = structuredClone(session);
  const accessTokenBefore = structuredClone(accessToken);

  const result = await validateJwtBoundAuthSession(crypto, session, accessToken, now);
  assert.equal(result.jti, "jti-001");

  assert.deepEqual(crypto, cryptoBefore);
  assert.deepEqual(session, sessionBefore);
  assert.deepEqual(accessToken, accessTokenBefore);
  assert.equal(now, NOW_ACTIVE);
});

test("never exposes injected sensitive fields in the success result", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());
  const crypto = {
    ...cryptoToken(),
  };
  // Sensitive fields must not be accepted on the crypto token shape either.
  await assertBindingNull(
    {
      ...crypto,
      compactJwt: "a.b.c",
      signature: "sig",
      signingInput: "a.b",
      kid: "kid-1",
      privateKey: "SECRET",
    },
    session,
    accessToken,
  );

  const result = await validateJwtBoundAuthSession(crypto, session, accessToken, NOW_ACTIVE);
  assert.deepEqual(Object.keys(result).sort(), ["jti", "principal", "sid", "sub"]);
  assert.equal(Object.hasOwn(result, "compactJwt"), false);
  assert.equal(Object.hasOwn(result, "signature"), false);
  assert.equal(Object.hasOwn(result, "signingInput"), false);
  assert.equal(Object.hasOwn(result, "kid"), false);
  assert.equal(Object.hasOwn(result, "privateKey"), false);
  assert.equal(Object.hasOwn(result, "CryptoKey"), false);
  assert.equal(Object.hasOwn(result.principal, "compactJwt"), false);
});

test("hostile objects settle as fulfilled null never as rejected promises", async () => {
  const session = createAuthSession(sessionInput());
  const accessToken = createAuthSessionAccessToken(accessTokenInput());

  const hostileCases = [
    [undefined, undefined, undefined, undefined],
    [null, null, null, null],
    [new Proxy(cryptoToken(), {}), session, accessToken, NOW_ACTIVE],
    [cryptoToken(), new Proxy(session, {}), accessToken, NOW_ACTIVE],
    [cryptoToken(), session, new Proxy(accessToken, {}), NOW_ACTIVE],
    [
      new Proxy(cryptoToken(), {
        get() {
          throw new Error("hostile");
        },
      }),
      session,
      accessToken,
      NOW_ACTIVE,
    ],
    [cryptoToken({ jti: "bad/jti" }), session, accessToken, NOW_ACTIVE],
    [{}, {}, {}, {}],
  ];

  const settled = await Promise.allSettled(
    hostileCases.map((args) => validateJwtBoundAuthSession(...args)),
  );

  for (const outcome of settled) {
    assert.equal(outcome.status, "fulfilled");
    assert.equal(outcome.value, null);
  }
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
