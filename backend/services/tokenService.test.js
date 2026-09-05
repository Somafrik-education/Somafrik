"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { TokenService } = require("../services/tokenService");

function service() {
  return new TokenService({
    secret: "a".repeat(48),
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 3600,
  });
}

function signWithHeader(tokenService, header, payload) {
  const now = Math.floor(Date.now() / 1000);
  const completePayload = {
    ...payload,
    iss: tokenService.issuer,
    iat: now,
    exp: now + 60,
    typ: payload.typ ?? "access",
  };
  const encodedHeader = tokenService.base64Url(JSON.stringify(header));
  const encodedPayload = tokenService.base64Url(JSON.stringify(completePayload));
  const signature = tokenService.base64Url(
    crypto.createHmac("sha256", tokenService.secret).update(`${encodedHeader}.${encodedPayload}`).digest(),
  );
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

test("verify refuse un en-tête alg autre que HS256 même si HMAC est valide", () => {
  const tokens = service();
  const forged = signWithHeader(tokens, { alg: "RS256", typ: "JWT" }, { sub: "u1", typ: "access" });
  assert.throws(() => tokens.verify(forged, "access"), /Algorithme JWT invalide/);
});

test("verify refuse un en-tête typ autre que JWT même si HMAC est valide", () => {
  const tokens = service();
  const forged = signWithHeader(tokens, { alg: "HS256", typ: "at+jwt" }, { sub: "u1", typ: "access" });
  assert.throws(() => tokens.verify(forged, "access"), /Type d'en-tête JWT invalide/);
});

test("verify refuse alg none", () => {
  const tokens = service();
  const forged = signWithHeader(tokens, { alg: "none", typ: "JWT" }, { sub: "u1", typ: "access" });
  assert.throws(() => tokens.verify(forged, "access"), /Algorithme JWT invalide/);
});

test("jeton nominal HS256 / JWT est accepté", () => {
  const tokens = service();
  const token = tokens.createAccessToken({ sub: "u1", role: "Admin School", schoolCode: "CD-2026-0001" });
  const payload = tokens.verify(token, "access");
  assert.equal(payload.sub, "u1");
  assert.equal(payload.typ, "access");
});
