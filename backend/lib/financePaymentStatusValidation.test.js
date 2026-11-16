"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertPaymentStatusPayload, assertKnownPaymentStatus } = require("./financePaymentStatusValidation");

test("A5 — POST vide ou valeurs mal typées ⇒ 400", () => {
  for (const payload of [{}, null, [], { code: " " }, { code: "OK" }, { code: 10, label: "OK" }, { code: "OK", label: "" }, { code: "OK", label: 2 }]) {
    assert.throws(() => assertPaymentStatusPayload(payload, { create: true }), (e) => e.statusCode === 400 && e.code === "FINANCE_PAYMENT_STATUS_INVALID");
  }
});
test("A5 — POST valide et PATCH partiel valide", () => {
  assert.doesNotThrow(() => assertPaymentStatusPayload({ code: "PAYE", label: "Payé", status: "Actif" }, { create: true }));
  assert.doesNotThrow(() => assertPaymentStatusPayload({ label: "Réglé" }));
  for (const payload of [{ label: null }, { status: "unknown" }, { sortOrder: "no" }]) {
    assert.throws(() => assertPaymentStatusPayload(payload), (e) => e.statusCode === 400);
  }
});
test("A5 — PATCH ID inconnu ⇒ 404, ID dans la liste ⇒ autorisé", () => {
  const rows = [{ code: "PAYE" }];
  assert.doesNotThrow(() => assertKnownPaymentStatus(rows, "PAYE"));
  assert.throws(() => assertKnownPaymentStatus(rows, "INCONNU"), (e) => e.statusCode === 404 && e.code === "FINANCE_PAYMENT_STATUS_NOT_FOUND");
});
