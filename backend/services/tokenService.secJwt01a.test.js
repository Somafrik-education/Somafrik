"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { TokenService, ACCESS_TOKEN_AUDIENCE, CLOCK_SKEW_SECONDS } = require("./tokenService");
const { MAX_ACCESS_TOKEN_LIFETIME_SECONDS, resolveAccessTokenTtlSeconds } = require("../lib/authTokenPolicy");
const { collectProductionSecretViolations } = require("../lib/productionSecrets");

// Secret de test généré à l'exécution (aucun littéral).
const SECRET = crypto.randomBytes(32).toString("hex");
const tokens = () => new TokenService({ secret: SECRET, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 3600 });
const now = () => Math.floor(Date.now() / 1000);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Jeton au format exact émis avant SEC-JWT-01a (en-tête alg/typ, aucun aud). */
function legacy(head, payload, key = SECRET) {
  const signed = `${b64(head)}.${b64(payload)}`;
  return `${signed}.${crypto.createHmac("sha256", key).update(signed).digest("base64url")}`;
}
const HEAD = { alg: "HS256", typ: "JWT" };
const accessPayload = (overrides = {}) => ({
  sub: "u1",
  sessionId: "11111111-1111-4111-8111-111111111111",
  typ: "access",
  aud: ACCESS_TOKEN_AUDIENCE,
  iss: "somafrik-api",
  iat: now(),
  exp: now() + 900,
  ...overrides,
});

test("SEC-JWT-01a — jeton d'accès émis : aud, iat, exp ≤ 900 s ; aud imposé par le serveur", () => {
  const service = tokens();
  const token = service.createAccessToken({ sub: "u1", aud: "autre-service", role: "Admin School" });
  const payload = service.verify(token, "access");
  assert.equal(payload.aud, ACCESS_TOKEN_AUDIENCE);
  assert.ok(Number.isInteger(payload.iat) && Number.isInteger(payload.exp));
  assert.ok(payload.exp - payload.iat <= MAX_ACCESS_TOKEN_LIFETIME_SECONDS);
  assert.equal(JSON.parse(Buffer.from(token.split(".")[0], "base64url")).kid, undefined);
});

test("SEC-JWT-01a — en-têtes : politique fermée (alg, typ)", () => {
  const service = tokens();
  assert.ok(service.verify(legacy(HEAD, accessPayload()), "access"));
  for (const extra of [
    { kid: "cle" },
    { kid: "" },
    { jku: "https://attaquant.example/jwks.json" },
    { x5u: "https://attaquant.example/c.pem" },
    { jwk: { kty: "oct", k: "x" } },
    { x5c: ["MIIB"] },
    { crit: ["exp"] },
    { cty: "JWT" },
  ]) {
    assert.throws(() => service.verify(legacy({ ...HEAD, ...extra }, accessPayload()), "access"), /non autorisé/, JSON.stringify(extra));
  }
  // Messages existants conservés.
  assert.throws(() => service.verify(legacy({ alg: "none", typ: "JWT" }, accessPayload()), "access"), /Algorithme JWT invalide/);
  assert.throws(() => service.verify(legacy({ alg: "HS256", typ: "at+jwt" }, accessPayload()), "access"), /Type d'en-tête JWT invalide/);
});

test("SEC-JWT-01a — exp et iat obligatoires, entiers", () => {
  const service = tokens();
  for (const overrides of [{ exp: undefined }, { iat: undefined }, { exp: "9999999999" }, { iat: "1" }, { exp: 1.5 }, { exp: -1 }, { exp: null }]) {
    const payload = accessPayload(overrides);
    for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete payload[key];
    assert.throws(() => service.verify(legacy(HEAD, payload), "access"), /Validité JWT invalide/, JSON.stringify(overrides));
  }
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat: now() - 3600, exp: now() - 1 })), "access"), /Token expire/);
});

test("SEC-JWT-01a — durée de vie maximale 900 s (accès)", () => {
  const service = tokens();
  assert.ok(service.verify(legacy(HEAD, accessPayload({ iat: now(), exp: now() + 900 })), "access"));
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat: now(), exp: now() + 901 })), "access"), /excessive/);
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat: now() - 100, exp: now() + 30 * 24 * 3600 })), "access"), /excessive/);
  // Émission : le TTL configuré ne peut plus dépasser 900 s, quel que soit l'environnement.
  assert.throws(() => resolveAccessTokenTtlSeconds({ JWT_ACCESS_TTL_SECONDS: "901" }), /trop élevé/);
  assert.equal(resolveAccessTokenTtlSeconds({ JWT_ACCESS_TTL_SECONDS: "900" }), 900);
});

test("SEC-JWT-01a — iat et nbf : tolérance d'horloge bornée", () => {
  const service = tokens();
  const skew = CLOCK_SKEW_SECONDS;
  assert.ok(skew > 0 && skew <= 120);
  assert.ok(service.verify(legacy(HEAD, accessPayload({ iat: now() + skew - 5, exp: now() + 600 })), "access"), "dans la tolérance");
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat: now() + skew + 60, exp: now() + skew + 600 })), "access"), /futur/);
  assert.ok(service.verify(legacy(HEAD, accessPayload({ nbf: now() - 10 })), "access"));
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ nbf: now() + skew + 60 })), "access"), /pas encore valide/);
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ nbf: "0" })), "access"), /pas encore valide/);
});

test("SEC-JWT-01a — aud exact pour les jetons d'accès ; jeton d'accès historique sans aud refusé", () => {
  const service = tokens();
  const historic = accessPayload();
  delete historic.aud;
  assert.throws(() => service.verify(legacy(HEAD, historic), "access"), /Audience JWT invalide/);
  for (const aud of ["autre-service", [ACCESS_TOKEN_AUDIENCE], "", "SOMAFRIK-API"]) {
    assert.throws(() => service.verify(legacy(HEAD, accessPayload({ aud })), "access"), /Audience JWT invalide/, JSON.stringify(aud));
  }
});

test("SEC-JWT-01a — refresh tokens et curseurs historiques (sans aud) toujours acceptés", () => {
  const service = tokens();
  const refresh = legacy(HEAD, {
    sub: "u1",
    sessionId: "11111111-1111-4111-8111-111111111111",
    role: "Admin School",
    jti: crypto.randomUUID(),
    typ: "refresh",
    iss: "somafrik-api",
    iat: now() - 6 * 24 * 3600,
    exp: now() + 24 * 3600,
  });
  assert.equal(service.verify(refresh, "refresh").typ, "refresh");
  const cursor = legacy(HEAD, { typ: "mobile_sync_cursor", schoolCode: "CD-2026-0001", iss: "somafrik-api", iat: now(), exp: now() + 3600 });
  assert.equal(service.verify(cursor, "mobile_sync_cursor").typ, "mobile_sync_cursor");
  // Émission inchangée pour ces finalités : aucun aud.
  assert.equal(JSON.parse(Buffer.from(service.createRefreshToken({ sub: "u1" }).token.split(".")[1], "base64url")).aud, undefined);
  // Un refresh token n'est jamais un jeton d'accès, même avec l'audience d'accès.
  assert.throws(() => service.verify(service.createRefreshToken({ sub: "u1" }).token, "access"), /Type de token invalide/);
});

test("SEC-JWT-01a — aucun secret public de repli", () => {
  const source = require("fs").readFileSync(require.resolve("./tokenService"), "utf8");
  assert.ok(!source.includes("somafrik-dev-secret-change-me"), "secret de développement codé en dur supprimé");
  // Hors production sans JWT_SECRET : secret aléatoire éphémère (même valeur dans le processus).
  const a = new TokenService({ env: { NODE_ENV: "development" } });
  const b = new TokenService({ env: { NODE_ENV: "test" } });
  assert.ok(a.secret && a.secret.length >= 32);
  assert.equal(a.secret, b.secret);
  assert.ok(b.verify(a.createAccessToken({ sub: "u1" }), "access"));
  const forged = legacy(HEAD, accessPayload(), "somafrik-dev-secret-change-me");
  assert.throws(() => a.verify(forged, "access"), /Signature JWT invalide/);
  // Production sans JWT_SECRET : ni signature ni vérification, démarrage refusé.
  const prod = new TokenService({ env: { NODE_ENV: "production" } });
  assert.throws(() => prod.createAccessToken({ sub: "u1" }), /JWT_SECRET est obligatoire/);
  assert.throws(() => prod.verify(legacy(HEAD, accessPayload()), "access"), /JWT_SECRET est obligatoire/);
  assert.ok(collectProductionSecretViolations({ NODE_ENV: "production" }).some((row) => row.includes("JWT_SECRET")));
  // Configuration explicite : utilisée telle quelle.
  assert.equal(new TokenService({ env: { JWT_SECRET: SECRET } }).secret, SECRET);
});

test("SEC-JWT-01a — cas limites : exp <= iat refusé, expiration dès exp <= now", () => {
  const service = tokens();
  const t = now();
  // Fenêtre vide ou inversée.
  for (const [iat, exp] of [[t - 10, t - 10], [t - 5, t - 10], [t, t]]) {
    assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat, exp })), "access"), /Validité JWT invalide|Token expire/, `${iat}/${exp}`);
  }
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat: t + 30, exp: t + 30 })), "access"), /Validité JWT invalide/, "exp = iat dans le futur");
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat: t + 30, exp: t + 20 })), "access"), /Validité JWT invalide/, "exp < iat");
  // Expiration à la seconde exacte : exp = now est expiré ; exp = now + 1 est valide.
  assert.throws(() => service.verify(legacy(HEAD, accessPayload({ iat: t - 60, exp: t })), "access"), /Token expire/);
  assert.ok(service.verify(legacy(HEAD, accessPayload({ iat: t - 60, exp: t + 2 })), "access"));
  // Mêmes règles pour les refresh tokens et les curseurs Mobile ; jetons émis toujours valides.
  const refreshBase = { sub: "u1", sessionId: "11111111-1111-4111-8111-111111111111", typ: "refresh", iss: "somafrik-api" };
  assert.throws(() => service.verify(legacy(HEAD, { ...refreshBase, iat: t - 60, exp: t }), "refresh"), /Token expire/);
  assert.throws(() => service.verify(legacy(HEAD, { ...refreshBase, iat: t, exp: t }), "refresh"), /Validité JWT invalide|Token expire/);
  assert.equal(service.verify(service.createRefreshToken({ sub: "u1" }).token, "refresh").typ, "refresh");
  const cursorBase = { typ: "mobile_sync_cursor", schoolCode: "CD-2026-0001", iss: "somafrik-api" };
  assert.throws(() => service.verify(legacy(HEAD, { ...cursorBase, iat: t - 60, exp: t }), "mobile_sync_cursor"), /Token expire/);
  assert.equal(service.verify(service.sign(cursorBase, 300), "mobile_sync_cursor").typ, "mobile_sync_cursor");
});
