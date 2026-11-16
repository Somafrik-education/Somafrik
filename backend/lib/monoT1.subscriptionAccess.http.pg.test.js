"use strict";

/**
 * MONO-T1 — porte d'abonnement sur fixtures RÉELLES (aucune date modifiée).
 *
 * Depuis la correction A2 (#1010), les dates ISO de subscriptions.end_date
 * sont lues correctement : le harnais n'efface plus la date de fin. Ce
 * fichier fige les comportements de la porte avec les données de
 * démonstration (backend/data.js) :
 *   - CD-2026-0001 : abonnement actif, fin 31-08-2027 ⇒ accès complet ;
 *   - SCH-DEMO-0017 : fin 31-05-2026 (échue) ⇒ « blocked », connexion refusée ;
 *   - SCH-DEMO-0022 : établissement suspendu ⇒ connexion refusée ;
 *   - droits insuffisants avec abonnement actif ⇒ refus RBAC maintenu.
 * Observation O9 (non corrigée ici) : un abonnement au statut DB « suspended »
 * est lu « limited », pas « blocked » (cf. MONO-T1-CHARACTERIZATION.md).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus, ACCOUNTS } = require("./monoT1HttpHarness");

const DAY = 24 * 60 * 60 * 1000;
let server = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_subscription_it", port: 19976 });
});

after(async () => {
  if (server) await server.stop();
});

async function accessOf(schoolCode) {
  const response = await server.request("GET", `/api/backoffice/subscription-access?schoolCode=${schoolCode}`, {
    token: await server.login("superAdmin"),
  });
  assertStatus(response, 200, `accès abonnement ${schoolCode}`);
  return response.data;
}

async function rawLogin(accountKey) {
  const account = ACCOUNTS[accountKey];
  return server.request("POST", "/api/backoffice/login", {
    body: { identifier: account.identifier, password: "1234", schoolCode: await server.loginCode(account.school) },
  });
}

async function endDateOf(schoolCode) {
  return (
    await server.one(
      `SELECT sub.end_date::text AS end_date, sub.status, sc.status AS school_status
       FROM subscriptions sub JOIN schools sc ON sc.id = sub.school_id WHERE sc.school_code = $1`,
      [schoolCode],
    )
  );
}

test("abonnement actif non échu (fixture réelle) : accès complet, la porte laisse passer la saisie", { skip }, async () => {
  const fixture = await endDateOf("CD-2026-0001");
  assert.equal(fixture.end_date, "2027-08-31", "fixture : date de fin réelle, non modifiée");
  assert.ok(new Date(`${fixture.end_date}T23:59:59`) > new Date(), "précondition : date de démonstration non dépassée");

  const access = await accessOf("CD-2026-0001");
  assert.deepEqual({ level: access.level, daysLate: access.daysLate }, { level: "full", daysLate: 0 });
  await server.assertActiveSubscriptionPrecondition("cdAdmin");

  const before = await server.snapshot("SELECT id FROM evaluations ORDER BY id");
  const response = await server.request("POST", "/api/evaluations", { token: await server.login("cdTeacher"), body: {} });
  assert.notEqual(response.status, 403, `porte abonnement franchie (réponse du gestionnaire) : ${response.text.slice(0, 200)}`);
  assert.equal(await server.snapshot("SELECT id FROM evaluations ORDER BY id"), before, "entrée invalide : aucune écriture");
});

test("abonnement échu (fin ISO 2026-05-31) : « blocked » avec le vrai retard, connexion refusée sans jeton", { skip }, async () => {
  const fixture = await endDateOf("SCH-DEMO-0017");
  assert.equal(fixture.end_date, "2026-05-31", "fixture : date de fin réelle");
  const expectedLate = Math.floor((Date.now() - new Date(2026, 4, 31).getTime()) / DAY);

  const access = await accessOf("SCH-DEMO-0017");
  assert.equal(access.level, "blocked");
  assert.ok(Math.abs(access.daysLate - expectedLate) <= 1, `retard lu ${access.daysLate} j, attendu ≈ ${expectedLate} j (date ISO correctement lue)`);

  const login = await rawLogin("expiredSchoolUser");
  assertStatus(login, 403, "connexion établissement à abonnement échu");
  assert.equal(login.data?.accessToken, undefined);
  assert.match(String(login.data?.message), /abonnement expiré ou impayé/);
});

test("établissement suspendu : connexion refusée sans jeton, accès jamais complet", { skip }, async () => {
  const fixture = await endDateOf("SCH-DEMO-0022");
  assert.equal(fixture.school_status, "suspended", "fixture : établissement suspendu");

  const login = await rawLogin("suspendedSchoolUser");
  assertStatus(login, 403, "connexion établissement suspendu");
  assert.equal(login.data?.accessToken, undefined);
  assert.match(String(login.data?.message), /Établissement suspendu/);

  const access = await accessOf("SCH-DEMO-0022");
  assert.notEqual(access.level, "full", "un établissement suspendu n'a jamais l'accès complet");
});

test("droits insuffisants malgré un abonnement actif : refus RBAC maintenu, sans écriture", { skip }, async () => {
  const before = await server.snapshot("SELECT id FROM evaluations ORDER BY id");
  const response = await server.request("POST", "/api/evaluations", {
    token: await server.login("cdParent"),
    body: { classId: "x", subject: "Sciences", period: "Trimestre 1", title: "MONO-T1", maxScore: 20 },
  });
  assertStatus(response, 403, "parent sur création d'évaluation");
  assert.equal(response.data?.code, "PERMISSION_DENIED");
  assert.equal(await server.snapshot("SELECT id FROM evaluations ORDER BY id"), before, "aucune écriture");
});
