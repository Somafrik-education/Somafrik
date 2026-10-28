"use strict";

/**
 * MONO-T1 / A — authentification et sessions (serveur réel, base jetable).
 *
 * Balayages sur TOUTES les routes authentifiées de l'inventaire runtime
 * (docs/project/MONO-T1-ROUTES.json, vérifié à jour par
 * `node scripts/mono-t1-route-inventory.js --check`) :
 *   anonyme, en-tête mal formé, signature étrangère, jeton expiré, session
 *   inconnue, jeton dans l'URL ⇒ 401 sans aucune donnée métier.
 * Puis scénarios ciblés : connexion, session révoquée (logout, revoke-all),
 * refresh, routes publiques et route E2E conditionnelle.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { TokenService } = require("../services/tokenService");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");
const inventory = require("../../docs/project/MONO-T1-ROUTES.json");

let server = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_auth_it", port: 19961 });
});

after(async () => {
  if (server) await server.stop();
});

const authenticatedRoutes = inventory.routes.filter((route) => route.authenticated && !route.pathIsRegExp);

function concretePath(routePath) {
  return routePath.replace(/:[A-Za-z_]\w*/g, "MONO-T1-INCONNU");
}

/** Réponse de refus : 401, corps limité à un message (et éventuellement un code). */
function assertRefusedWithoutData(response, label) {
  assertStatus(response, 401, label);
  assert.ok(response.data && typeof response.data === "object" && !Array.isArray(response.data), `${label} : corps JSON objet`);
  const extra = Object.keys(response.data).filter((key) => !["message", "code"].includes(key));
  assert.deepEqual(extra, [], `${label} : aucune donnée hors message/code`);
}

async function sweep(headersFor, label) {
  const failures = [];
  for (const route of authenticatedRoutes) {
    const response = await server.request(route.method, concretePath(route.path), {
      headers: headersFor(route),
      body: route.method === "GET" || route.method === "DELETE" ? undefined : {},
    });
    try {
      assertRefusedWithoutData(response, `${label} ${route.method} ${route.path}`);
    } catch (error) {
      failures.push(error.message);
    }
  }
  assert.deepEqual(failures, [], `${failures.length} route(s) non conformes`);
}

test("inventaire : au moins 350 routes authentifiées relevées au runtime", { skip }, () => {
  assert.ok(authenticatedRoutes.length >= 350, `${authenticatedRoutes.length} routes authentifiées`);
});

test("contrôle : une session réelle passe, et le jeton re-signé par le banc aussi (balayages non vides de sens)", { skip }, async () => {
  const realToken = await server.login("cdAdmin");
  assertStatus(await server.request("GET", "/api/students", { token: realToken }), 200, "session réelle");
  const claims = JSON.parse(Buffer.from(realToken.split(".")[1], "base64url").toString("utf8"));
  const resigned = new TokenService({ secret: server.jwtSecret }).createAccessToken({ ...claims, exp: undefined, iat: undefined });
  assertStatus(
    await server.request("GET", "/api/auth/effective-permissions", { token: resigned }),
    200,
    "mêmes revendications, même session, re-signées par le banc",
  );
});

test("balayage : toute route authentifiée refuse l'accès anonyme (401, aucune donnée)", { skip }, async () => {
  await sweep(() => ({}), "anonyme");
});

test("balayage : en-tête Authorization mal formé ou jeton illisible ⇒ 401", { skip }, async () => {
  const variants = ["Bearer", "Bearer pas.un.jwt", "Basic dXNlcjpwYXNz", "Token abc"];
  let index = 0;
  await sweep(() => ({ Authorization: variants[index++ % variants.length] }), "en-tête invalide");
});

test("balayage : jeton signé avec un autre secret ⇒ 401", { skip }, async () => {
  const forger = new TokenService({ secret: crypto.randomBytes(32).toString("hex") });
  const token = forger.createAccessToken({
    sub: crypto.randomUUID(),
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
    permissions: ["ALL_PRIVILEGES"],
    sessionId: crypto.randomUUID(),
  });
  await sweep(() => ({ Authorization: `Bearer ${token}` }), "signature étrangère");
});

test("balayage : jeton correctement signé mais expiré ⇒ 401", { skip }, async () => {
  const realToken = await server.login("cdAdmin");
  const claims = JSON.parse(Buffer.from(realToken.split(".")[1], "base64url").toString("utf8"));
  const expired = new TokenService({ secret: server.jwtSecret, accessTokenTtlSeconds: -60 }).createAccessToken({
    ...claims,
    exp: undefined,
    iat: undefined,
  });
  await sweep(() => ({ Authorization: `Bearer ${expired}` }), "jeton expiré");
});

test("balayage : jeton correctement signé sur une session inexistante ⇒ 401", { skip }, async () => {
  const realToken = await server.login("cdAdmin");
  const claims = JSON.parse(Buffer.from(realToken.split(".")[1], "base64url").toString("utf8"));
  const orphan = new TokenService({ secret: server.jwtSecret }).createAccessToken({
    ...claims,
    sessionId: crypto.randomUUID(),
    exp: undefined,
    iat: undefined,
  });
  await sweep(() => ({ Authorization: `Bearer ${orphan}` }), "session inconnue");
});

test("jeton dans la chaîne de requête (paramètres token et access_token) refusé même valide", { skip }, async () => {
  const token = await server.login("cdAdmin");
  for (const param of ["token", "access_token"]) {
    const response = await server.request("GET", `/api/students?${param}=${encodeURIComponent(token)}`);
    assertRefusedWithoutData(response, `paramètre ${param}`);
  }
});

test("connexion : mauvais mot de passe ou établissement erroné ⇒ refus sans jeton", { skip }, async () => {
  const loginCode = await server.loginCode("CD-2026-0001");
  const wrongPassword = await server.request("POST", "/api/backoffice/login", {
    body: { identifier: "admin@unikin.somafrik", password: "mauvais", schoolCode: loginCode },
  });
  assertStatus(wrongPassword, [400, 401, 403], "mauvais mot de passe");
  assert.equal(wrongPassword.data?.accessToken, undefined);

  const otherSchool = await server.request("POST", "/api/backoffice/login", {
    body: { identifier: "admin@unikin.somafrik", password: "1234", schoolCode: await server.loginCode("BI-2026-0002") },
  });
  assertStatus(otherSchool, [400, 401, 403, 404], "connexion sur un autre établissement");
  assert.equal(otherSchool.data?.accessToken, undefined);

  const empty = await server.request("POST", "/api/backoffice/login", { body: {} });
  assertStatus(empty, [400, 401], "connexion sans identifiants");
  assert.equal(empty.data?.accessToken, undefined);
});

test("connexion valide : jeton d'accès + refresh, réponse sans secret", { skip }, async () => {
  const response = await server.request("POST", "/api/backoffice/login", {
    body: { identifier: "admin@unikin.somafrik", password: "1234", schoolCode: await server.loginCode("CD-2026-0001") },
  });
  assertStatus(response, 200, "connexion");
  assert.ok(response.data.accessToken && response.data.refreshToken);
  assert.doesNotMatch(response.text, /password_hash|pin_hash|passwordHash|\$2[aby]\$/, "aucun hachage de secret exposé");
});

test("logout : la session fermée refuse ensuite toute route", { skip }, async () => {
  const loginCode = await server.loginCode("CD-2026-0001");
  const login = await server.request("POST", "/api/backoffice/login", {
    body: { identifier: "secretaire@somafrik.app", password: "1234", schoolCode: loginCode },
  });
  assertStatus(login, 200, "connexion secrétaire");
  const token = login.data.accessToken;
  assertStatus(await server.request("GET", "/api/auth/effective-permissions", { token }), 200, "avant logout");
  assertStatus(await server.request("POST", "/api/auth/logout", { token, body: {} }), [200, 204], "logout");
  assertRefusedWithoutData(await server.request("GET", "/api/auth/effective-permissions", { token }), "après logout");
  const refreshed = await server.request("POST", "/api/auth/refresh", { body: { refreshToken: login.data.refreshToken } });
  assertStatus(refreshed, [400, 401, 403], "refresh après logout");
  assert.equal(refreshed.data?.accessToken, undefined);
});

test("revoke-all : toutes les sessions du compte sont fermées", { skip }, async () => {
  const loginCode = await server.loginCode("CD-2026-0001");
  const credentials = { identifier: "prefet@somafrik.app", password: "1234", schoolCode: loginCode };
  const first = await server.request("POST", "/api/backoffice/login", { body: credentials });
  const second = await server.request("POST", "/api/backoffice/login", { body: credentials });
  assertStatus(first, 200, "session 1");
  assertStatus(second, 200, "session 2");
  assertStatus(await server.request("POST", "/api/auth/revoke-all", { token: first.data.accessToken, body: {} }), [200, 204], "revoke-all");
  for (const [label, token] of [["session 1", first.data.accessToken], ["session 2", second.data.accessToken]]) {
    assertRefusedWithoutData(await server.request("GET", "/api/auth/effective-permissions", { token }), `${label} après revoke-all`);
  }
});

test("refresh : jeton de refresh invalide ou jeton d'accès utilisé comme refresh ⇒ refus", { skip }, async () => {
  const access = await server.login("cdAdmin");
  for (const [label, refreshToken] of [["vide", ""], ["illisible", "pas.un.jwt"], ["jeton d'accès", access]]) {
    const response = await server.request("POST", "/api/auth/refresh", { body: { refreshToken } });
    assertStatus(response, [400, 401, 403], `refresh ${label}`);
    assert.equal(response.data?.accessToken, undefined, `refresh ${label} : aucun jeton émis`);
  }
});

test("routes publiques : santé, code établissement inconnu, route E2E désactivée", { skip }, async () => {
  assertStatus(await server.request("GET", "/api/health"), 200, "santé");
  const unknown = await server.request("GET", "/api/schools/MONO-T1-INCONNU");
  assertStatus(unknown, 404, "établissement inconnu");
  const known = await server.request("GET", `/api/schools/${await server.loginCode("CD-2026-0001")}`);
  assertStatus(known, 200, "établissement connu");
  assert.doesNotMatch(known.text, /@|password|phone|telephone/i, "fiche publique sans données personnelles");
  // Sans SOMAFRIK_E2E=true : la route de réinitialisation des verrous n'existe pas (404).
  assertStatus(await server.request("POST", "/api/backoffice/e2e/clear-login-lockout", { body: {} }), 404, "route E2E");
});


test("REFRESH-R1 : identité et rôles enseignants conservés lors du refresh", { skip }, async () => {
  const original = await server.request("POST", "/api/backoffice/login", {
    body: { identifier: "patrick.ilunga@somafrik.cd", password: "1234", schoolCode: "CD-2026-0001" },
  });
  assertStatus(original, 200, "login enseignant");
  const refreshed = await server.request("POST", "/api/auth/refresh", {
    body: { refreshToken: original.data.refreshToken },
  });
  assertStatus(refreshed, 200, "refresh enseignant");
  const decode = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  const before = decode(original.data.accessToken);
  const after = decode(refreshed.data.accessToken);
  assert.equal(after.role, before.role, "le libellé de rôle ne devient pas TEACHER");
  assert.deepEqual(after.roleKeys, before.roleKeys, "les rôles actifs sont conservés");
  assert.equal(after.schoolCode, before.schoolCode);
  assert.equal(after.schoolId, before.schoolId);
  assert.equal(after.userId, before.userId);
});
