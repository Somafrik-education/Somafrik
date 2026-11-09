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

test("A5-R1 : PATCH partiel conserve les champs omis et refuse toute création implicite", { skip }, async () => {
  const token = await server.login("cdAdmin");
  const code = "MONO-A5-R1-ONLY";
  const created = await server.request("POST", "/api/finance/payment-statuses", {
    token, body: { code, label: "Initial", status: "Inactif", sortOrder: 13 },
  });
  assert.equal(created.status, 201);
  const first = await server.request("PATCH", "/api/finance/payment-statuses/" + code, {
    token, body: { label: "Modifié" },
  });
  assert.equal(first.status, 200);
  const persisted = await server.one("SELECT label, is_active, sort_order FROM payment_statuses WHERE status_code = $1", [code]);
  assert.equal(persisted.label, "Modifié");
  assert.equal(persisted.is_active, false);
  assert.equal(Number(persisted.sort_order), 13);
  const second = await server.request("PATCH", "/api/finance/payment-statuses/" + code, {
    token, body: { sortOrder: 17 },
  });
  assert.equal(second.status, 200);
  const after = await server.one("SELECT label, is_active, sort_order FROM payment_statuses WHERE status_code = $1", [code]);
  assert.deepEqual(after, { label: "Modifié", is_active: false, sort_order: 17 });
});
