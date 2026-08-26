"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const {
  MOBILE_SYNC_ERROR,
  MOBILE_SYNC_CURSOR_TYP,
  MOBILE_SYNC_SCHEMA_VERSION,
  MOBILE_SYNC_GENERATION,
  SENTINEL_UPDATED_AT,
  SENTINEL_ID,
} = require("./mobileSyncErrors");
const {
  encodeMobileSyncCursor,
  decodeMobileSyncCursor,
  assertCursorBindings,
} = require("./mobileSyncCursor");

function tokenService() {
  return new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
}

function sampleInput(overrides = {}) {
  return {
    resource: "classes",
    schoolCode: "SCH-A",
    schoolId: "school-a",
    principalId: "user-a",
    scopeHash: "abc123",
    lastUpdatedAt: "2026-08-01T10:00:00.000Z",
    lastId: "00000000-0000-4000-8000-00000000000a",
    ...overrides,
  };
}

function samplePrincipal(overrides = {}) {
  return {
    sub: "user-a",
    schoolCode: "SCH-A",
    role: "Admin School",
    permissions: ["Voir classes"],
    ...overrides,
  };
}

test("encode/decode round-trip conserve le keyset et le scopeHash", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput(), tokens);
  assert.equal(encoded.split(".").length, 3);
  const decoded = decodeMobileSyncCursor(encoded, tokens);
  assert.equal(decoded.resource, "classes");
  assert.equal(decoded.schoolCode, "SCH-A");
  assert.equal(decoded.principalId, "user-a");
  assert.equal(decoded.scopeHash, "abc123");
  assert.equal(decoded.lastUpdatedAt, "2026-08-01T10:00:00.000Z");
  assert.equal(decoded.lastId, "00000000-0000-4000-8000-00000000000a");
  assert.equal(decoded.schemaVersion, MOBILE_SYNC_SCHEMA_VERSION);
  assert.equal(decoded.generation, MOBILE_SYNC_GENERATION);
});

test("curseur opaque : le client ne peut pas lire lastUpdatedAt sans HMAC", () => {
  const encoded = encodeMobileSyncCursor(sampleInput(), tokenService());
  assert.equal(encoded.includes("2026-08-01T10:00:00.000Z"), false);
  assert.equal(encoded.includes("abc123"), false);
});

test("tampering de la signature → MOBILE_SYNC_CURSOR_INVALID", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput(), tokens);
  const tampered = `${encoded.slice(0, -2)}aa`;
  assert.throws(
    () => decodeMobileSyncCursor(tampered, tokens),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("payload modifié sans re-signature → refus", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput(), tokens);
  const [header, payload, signature] = encoded.split(".");
  const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decodedPayload.schoolCode = "SCH-B";
  const forgedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString("base64url").replace(/=/g, "");
  assert.throws(
    () => decodeMobileSyncCursor(`${header}.${forgedPayload}.${signature}`, tokens),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("resource mismatch students → refus", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput({ resource: "students" }), tokens);
  assert.throws(
    () => decodeMobileSyncCursor(encoded, tokens),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("curseur students round-trip avec resource attendu", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput({ resource: "students" }), tokens);
  const decoded = decodeMobileSyncCursor(encoded, tokens, { resource: "students" });
  assert.equal(decoded.resource, "students");
  assert.equal(decoded.schoolCode, "SCH-A");
  assert.equal(decoded.lastId, "00000000-0000-4000-8000-00000000000a");
});

test("curseur classes inutilisable sur students et inversement", () => {
  const tokens = tokenService();
  const classesCursor = encodeMobileSyncCursor(sampleInput({ resource: "classes" }), tokens);
  const studentsCursor = encodeMobileSyncCursor(sampleInput({ resource: "students" }), tokens);
  assert.throws(
    () => decodeMobileSyncCursor(classesCursor, tokens, { resource: "students" }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
  assert.throws(
    () => decodeMobileSyncCursor(studentsCursor, tokens, { resource: "classes" }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("schemaVersion non supporté → expired / full_required", () => {
  const tokens = tokenService();
  const encoded = tokens.sign(
    {
      typ: MOBILE_SYNC_CURSOR_TYP,
      sv: 99,
      gen: MOBILE_SYNC_GENERATION,
      resource: "classes",
      schoolCode: "SCH-A",
      schoolId: "school-a",
      principalId: "user-a",
      scopeHash: "abc123",
      lastUpdatedAt: SENTINEL_UPDATED_AT,
      lastId: SENTINEL_ID,
    },
    3600,
  );
  assert.throws(
    () => decodeMobileSyncCursor(encoded, tokens),
    (error) => error.statusCode === 409 && error.code === MOBILE_SYNC_ERROR.CURSOR_EXPIRED,
  );
});

test("génération de sync invalide → expired", () => {
  const tokens = tokenService();
  const encoded = tokens.sign(
    {
      typ: MOBILE_SYNC_CURSOR_TYP,
      sv: MOBILE_SYNC_SCHEMA_VERSION,
      gen: 99,
      resource: "classes",
      schoolCode: "SCH-A",
      schoolId: "school-a",
      principalId: "user-a",
      scopeHash: "abc123",
      lastUpdatedAt: SENTINEL_UPDATED_AT,
      lastId: SENTINEL_ID,
    },
    3600,
  );
  assert.throws(
    () => decodeMobileSyncCursor(encoded, tokens),
    (error) => error.statusCode === 409 && error.code === MOBILE_SYNC_ERROR.CURSOR_EXPIRED,
  );
});

test("TTL dépassé → expired", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput(), tokens, { ttlSeconds: -30 });
  assert.throws(
    () => decodeMobileSyncCursor(encoded, tokens),
    (error) => error.statusCode === 409 && error.code === MOBILE_SYNC_ERROR.CURSOR_EXPIRED,
  );
});

test("tenant mismatch → 403 fail-closed", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput(), tokens);
  const decoded = decodeMobileSyncCursor(encoded, tokens);
  assert.throws(
    () => assertCursorBindings(decoded, samplePrincipal({ schoolCode: "SCH-B" })),
    (error) => error.statusCode === 403 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("principal mismatch → 400 fail-closed", () => {
  const tokens = tokenService();
  const encoded = encodeMobileSyncCursor(sampleInput(), tokens);
  const decoded = decodeMobileSyncCursor(encoded, tokens);
  assert.throws(
    () => assertCursorBindings(decoded, samplePrincipal({ sub: "user-b" })),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("access JWT n'est pas un curseur", () => {
  const tokens = tokenService();
  const access = tokens.createAccessToken({ sub: "user-a", schoolCode: "SCH-A", typ: "access" });
  assert.throws(
    () => decodeMobileSyncCursor(access, tokens),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("curseur vide ou non JWT → invalid", () => {
  const tokens = tokenService();
  assert.throws(
    () => decodeMobileSyncCursor("", tokens),
    (error) => error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
  assert.throws(
    () => decodeMobileSyncCursor("not-a-jwt", tokens),
    (error) => error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

const {
  resolveMobileSyncCursorTtlSeconds,
  MOBILE_SYNC_CURSOR_TTL_DEFAULT_SECONDS,
  MOBILE_SYNC_CURSOR_TTL_MAX_SECONDS,
} = require("./mobileSyncErrors");

test("TTL env absent → 30 jours", () => {
  assert.equal(resolveMobileSyncCursorTtlSeconds(""), MOBILE_SYNC_CURSOR_TTL_DEFAULT_SECONDS);
  assert.equal(resolveMobileSyncCursorTtlSeconds(undefined), MOBILE_SYNC_CURSOR_TTL_DEFAULT_SECONDS);
});

test("TTL env invalide (abc, NaN, ≤0, hors borne) → fail-closed", () => {
  for (const raw of ["abc", "NaN", "0", "-10", String(MOBILE_SYNC_CURSOR_TTL_MAX_SECONDS + 1), "Infinity"]) {
    assert.throws(
      () => resolveMobileSyncCursorTtlSeconds(raw),
      (error) => error.code === "MOBILE_SYNC_CURSOR_TTL_INVALID" && error.statusCode === 500,
    );
  }
});

test("TTL env valide est borné et entier", () => {
  assert.equal(resolveMobileSyncCursorTtlSeconds("3600"), 3600);
  assert.equal(resolveMobileSyncCursorTtlSeconds("90.9"), 90);
});

test("encode refuse un ttlSeconds non fini", () => {
  const tokens = tokenService();
  assert.throws(
    () => encodeMobileSyncCursor(sampleInput(), tokens, { ttlSeconds: Number.NaN }),
    (error) => error.code === "MOBILE_SYNC_CURSOR_TTL_INVALID",
  );
});
