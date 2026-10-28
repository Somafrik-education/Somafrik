"use strict";

/**
 * ANOMALIE-MONO-T1-A2 — abonnement actif vu « suspendu » (date ISO mal lue).
 *
 * CORRIGÉE par #1010 (d306a0de) : test de non-régression, exécuté normalement
 * par la baseline pg (retiré de manifest › expectedFailures).
 *
 * Constat : schoolSubscriptionAccessService.parseFrDate découpe « AAAA-MM-JJ »
 * sur « - » et lit [jour, mois, année] : 2027-08-31 devient le 2027 août 0031,
 * soit ~32 000 jours de retard. La colonne subscriptions.end_date (DATE)
 * renvoie toujours de l'ISO : tout établissement à abonnement daté est
 * « blocked » et perd les fonctions sous abonnement (notes, présences,
 * création d'élève, annonces, notifications).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resolveSchoolAccess } = require("../services/schoolSubscriptionAccessService");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_anomaly_a2_it", port: 19972 });
  // Abonnement actif jusqu'à dans un an, au format natif de la colonne (DATE → ISO).
  await server.pool.query("UPDATE subscriptions SET end_date = CURRENT_DATE + 365, status = 'active'");
});

after(async () => {
  if (server) await server.stop();
});

test("ANOMALIE-MONO-T1-A2 : une date de fin ISO future donne un accès complet (service)", () => {
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const access = resolveSchoolAccess("X", { schools: [{ code: "X" }], subscriptions: [{ schoolCode: "X", status: "Actif", endDate: future }] });
  assert.equal(access.level, "full", `ANOMALIE-MONO-T1-A2 : endDate ISO ${future} lue avec ${access.daysLate} jours de retard`);
});

test("ANOMALIE-MONO-T1-A2 : établissement à abonnement actif — accès complet et saisie autorisée (HTTP)", { skip }, async () => {
  const access = await server.request("GET", "/api/backoffice/subscription-access", { token: await server.login("cdAdmin") });
  assertStatus(access, 200, "accès abonnement");
  assert.equal(
    access.data.level,
    "full",
    `ANOMALIE-MONO-T1-A2 : abonnement actif vu « ${access.data.level} » (${access.data.daysLate} jours de retard)`,
  );
});
