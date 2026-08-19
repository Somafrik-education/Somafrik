"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWriteItems,
  decoratePaymentWithItems,
  inventoryHistoricalPayments,
  resolvePaymentMethod,
} = require("./financePaymentItems");
const { FINANCE_ERROR } = require("./financeManagement");

test("items vides refusés", () => {
  assert.throws(
    () => normalizeWriteItems({ items: [] }),
    (error) => error.code === FINANCE_ERROR.PAYMENT_ITEMS_REQUIRED,
  );
});

test("legacy feeType+amount devient une ligne", () => {
  const items = normalizeWriteItems({ feeType: "Minerval / scolarité", amount: 500 });
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 500);
});

test("total client ignoré — decorate somme les lignes", () => {
  const payment = decoratePaymentWithItems(
    { amount: 1, reference: "PAY-0004", feeType: "x" },
    [
      { fee_label: "Minerval", amount: 500 },
      { fee_label: "Examen", amount: 1 },
      { fee_label: "Cantine", amount: 40 },
    ],
  );
  assert.equal(payment.totalAmount, 541);
  assert.equal(payment.itemCount, 3);
  assert.equal(payment.itemsDetail, "3 libellés");
});

test("inventaire historique : pas de fusion élève+date", () => {
  const report = inventoryHistoricalPayments({ payments: 10, paymentsWithItems: 10, paymentsWithoutItems: 0 });
  assert.equal(report.mergeByStudentAndDate, false);
  assert.equal(report.backfillStrategy, "one-payment-one-item");
});

test("paymentMethod cash → Espèces", () => {
  assert.equal(resolvePaymentMethod({ paymentMethod: "cash" }), "Espèces");
});
