"use strict";

/**
 * ANOMALIE-MONO-T1-A5 — statuts de paiement créés sans validation.
 *
 * CORRIGÉ par MONO-FIX-A5 : test de non-régression exécuté normalement.
 *
 * Ancien constat (relevé par le balayage RBAC MONO-T1) : POST et PATCH
 * /api/finance/payment-statuses passent tous deux par
 * upsertFinancePaymentStatus :
 *   - POST {} crée un statut au code et au libellé vides (201) ;
 *   - PATCH sur un identifiant inconnu CRÉE un statut nommé d'après l'URL (200).
 * Attendu : 400 sans écriture pour un corps vide, 404 sans écriture pour un
 * identifiant inconnu.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip } = require("./monoT1HttpHarness");

let server = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_anomaly_a5_it", port: 19975 });
});

after(async () => {
  if (server) await server.stop();
});

test("ANOMALIE-MONO-T1-A5 : corps vide refusé (400) et identifiant inconnu introuvable (404), sans écriture", { skip }, async () => {
  const token = await server.login("cdAdmin");
  const before = await server.snapshot("SELECT id FROM payment_statuses ORDER BY id");
  const empty = await server.request("POST", "/api/finance/payment-statuses", { token, body: {} });
  const unknown = await server.request("PATCH", "/api/finance/payment-statuses/MONO-T1-INCONNU", { token, body: { label: "x" } });
  const unchanged = (await server.snapshot("SELECT id FROM payment_statuses ORDER BY id")) === before;
  assert.deepEqual(
    { empty: empty.status, unknown: unknown.status, unchanged },
    { empty: 400, unknown: 404, unchanged: true },
    `ANOMALIE-MONO-T1-A5 : POST {} → HTTP ${empty.status}, PATCH inconnu → HTTP ${unknown.status}, écriture ${unchanged ? "aucune" : "effectuée"}`,
  );
});
