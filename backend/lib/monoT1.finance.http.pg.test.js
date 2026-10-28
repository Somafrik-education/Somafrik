"use strict";

/**
 * MONO-T1 / E — finance (serveur réel, base jetable, démo seed).
 *
 * Encaissements (POST /api/payments), contrôle de doublon (Idempotency-Key),
 * annulation, lectures et obligations : autorisé, anonyme, permission
 * insuffisante, Superadmin (données personnelles établissement interdites),
 * interétablissement (aucune fuite), entrée invalide, absence d'écriture.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;
let paymentId = null;
const STUDENT = "CD-IN-EL-26-001";
const STUDENT_2 = "CD-IN-EL-26-002";

const paymentBody = (studentId, amount = 5, extra = {}) => ({
  studentId,
  items: [{ feeType: "Non imputé", amount }],
  method: "Espèces",
  date: "2026-10-20",
  ...extra,
});

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_finance_it", port: 19965 });
  await server.assertActiveSubscriptionPrecondition();
});

after(async () => {
  if (server) await server.stop();
});

const payments = () => server.snapshot("SELECT id, amount, cancelled_at FROM payments ORDER BY id");
const paymentCount = async (studentCode, date) =>
  (
    await server.one(
      `SELECT count(*)::int AS n FROM payments p JOIN students s ON s.id = p.student_id
       WHERE s.student_code = $1 AND p.payment_date = $2`,
      [studentCode, date],
    )
  ).n;

test("encaissement : autorisé (201) et persisté dans l'établissement de l'élève", { skip }, async () => {
  const created = await server.request("POST", "/api/payments", { token: await server.login("cdAdmin"), body: paymentBody(STUDENT) });
  assertStatus(created, 201, "encaissement admin CD");
  paymentId = created.data.id;
  const row = await server.one(
    `SELECT p.amount::float AS amount, s.school_code FROM payments p JOIN schools s ON s.id = p.school_id WHERE p.payment_code = $1`,
    [paymentId],
  );
  assert.deepEqual(row, { amount: 5, school_code: "CD-2026-0001" });
});

test("encaissement refusé : montant nul/négatif, reçu vide, BI, enseignant, parent, Superadmin, anonyme — sans écriture", { skip }, async () => {
  const before = await payments();
  const refusals = [
    ["montant négatif", "cdAdmin", paymentBody(STUDENT, -5), 400, "PAYMENT_ITEM_AMOUNT_INVALID"],
    ["montant nul", "cdAdmin", paymentBody(STUDENT, 0), 400, "PAYMENT_ITEM_AMOUNT_INVALID"],
    ["reçu sans libellé", "cdAdmin", { studentId: STUDENT, items: [] }, 400, "PAYMENT_ITEMS_REQUIRED"],
    ["admin BI → élève CD", "biAdmin", paymentBody(STUDENT), 404, "STUDENT_NOT_FOUND"],
    ["enseignant", "cdTeacher", paymentBody(STUDENT), 403, "PERMISSION_DENIED"],
    ["parent", "cdParent", paymentBody(STUDENT), 403, "PERMISSION_DENIED"],
    ["Superadmin", "superAdmin", paymentBody(STUDENT), 403, "PLATFORM_PERSONAL_DATA_DENIED"],
    ["anonyme", null, paymentBody(STUDENT), 401, undefined],
  ];
  for (const [label, account, body, status, code] of refusals) {
    const response = await server.request("POST", "/api/payments", { token: account && (await server.login(account)), body });
    assertStatus(response, status, label);
    if (code) assert.equal(response.data.code, code, label);
  }
  assert.equal(await payments(), before, "aucun paiement écrit après refus");
});

test("doublon : même Idempotency-Key ⇒ même reçu, une seule ligne ; clé réutilisée avec un autre corps ⇒ 409", { skip }, async () => {
  const token = await server.login("cdAdmin");
  const headers = { "Idempotency-Key": "mono-t1-finance-1" };
  const body = paymentBody(STUDENT_2, 7, { date: "2026-10-21" });
  const first = await server.request("POST", "/api/payments", { token, body, headers });
  assertStatus(first, 201, "premier envoi");
  const replay = await server.request("POST", "/api/payments", { token, body, headers });
  assertStatus(replay, 201, "rejeu");
  assert.equal(replay.data.id, first.data.id, "même reçu");
  assert.equal(await paymentCount(STUDENT_2, "2026-10-21"), 1, "une seule ligne");
  const reused = await server.request("POST", "/api/payments", { token, body: { ...body, items: [{ feeType: "Non imputé", amount: 9 }] }, headers });
  assertStatus(reused, 409, "clé réutilisée, autre corps");
  assert.equal(reused.data.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await paymentCount(STUDENT_2, "2026-10-21"), 1, "toujours une seule ligne");
  // Sans clé, deux envois identiques créent deux reçus (comportement actuel, aucun dédoublonnage métier).
  await server.request("POST", "/api/payments", { token, body: paymentBody(STUDENT_2, 3, { date: "2026-10-22" }) });
  await server.request("POST", "/api/payments", { token, body: paymentBody(STUDENT_2, 3, { date: "2026-10-22" }) });
  assert.equal(await paymentCount(STUDENT_2, "2026-10-22"), 2, "sans Idempotency-Key : deux reçus");
});

test("lectures : liste et reçu bornés à l'établissement ; BI vide/404 ; Superadmin interdit", { skip }, async () => {
  const cd = await server.request("GET", "/api/payments", { token: await server.login("cdAdmin") });
  assertStatus(cd, 200, "liste CD");
  assert.ok(cd.data.some((payment) => payment.id === paymentId));
  const bi = await server.request("GET", "/api/payments", { token: await server.login("biAdmin") });
  assertStatus(bi, 200, "liste BI");
  assert.deepEqual(bi.data, []);
  assertStatus(await server.request("GET", `/api/payments/${paymentId}`, { token: await server.login("biAdmin") }), 404, "reçu CD depuis BI");
  assertStatus(await server.request("GET", "/api/payments", { token: await server.login("superAdmin") }), 403, "Superadmin");
  assertStatus(await server.request("GET", "/api/payments", { token: await server.login("cdTeacher") }), 403, "enseignant");
  for (const route of ["/api/finance/student-fees", "/api/backoffice/finance/unpaid"]) {
    const response = await server.request("GET", route, { token: await server.login("biAdmin") });
    assertStatus(response, 200, `${route} BI`);
    const rows = Array.isArray(response.data) ? response.data : response.data.items ?? response.data.rows ?? [];
    assert.ok(rows.every((row) => !JSON.stringify(row).includes("CD-2026-0001")), `${route} : aucune donnée de CD vue depuis BI`);
  }
});

test("annulation : refus BI/enseignant/sans motif sans écriture ; autorisée avec motif ; rejeu sans effet", { skip }, async () => {
  const before = await payments();
  const refusals = [
    ["admin BI", "biAdmin", { reason: "x" }, 404, "PAYMENT_NOT_FOUND"],
    ["enseignant", "cdTeacher", { reason: "x" }, 403, "PERMISSION_DENIED"],
    ["sans motif", "cdAdmin", {}, 400, "CANCEL_REASON_REQUIRED"],
    ["anonyme", null, { reason: "x" }, 401, undefined],
  ];
  for (const [label, account, body, status, code] of refusals) {
    const response = await server.request("POST", `/api/payments/${paymentId}/cancel`, { token: account && (await server.login(account)), body });
    assertStatus(response, status, label);
    if (code) assert.equal(response.data.code, code, label);
  }
  assert.equal(await payments(), before, "aucune annulation après refus");
  const token = await server.login("cdAdmin");
  assertStatus(await server.request("POST", `/api/payments/${paymentId}/cancel`, { token, body: { reason: "Erreur de saisie MONO-T1" } }), 200, "annulation");
  assertStatus(await server.request("POST", `/api/payments/${paymentId}/cancel`, { token, body: { reason: "Second motif" } }), 200, "rejeu");
  const row = await server.one(
    `SELECT cancelled_at IS NOT NULL AS cancelled, to_jsonb(p)->>'cancel_reason' AS reason FROM payments p WHERE payment_code = $1`,
    [paymentId],
  );
  assert.deepEqual(row, { cancelled: true, reason: "Erreur de saisie MONO-T1" }, "le motif initial est conservé");
});
