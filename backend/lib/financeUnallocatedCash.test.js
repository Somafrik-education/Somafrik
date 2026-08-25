"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  UNALLOCATED_STATUS,
  resolvePaymentStatus,
  projectPaymentCash,
  projectPaymentsWithAllocations,
  cashBucketsFromPayments,
} = require("./financeUnallocatedCash");

describe("financeUnallocatedCash", () => {
  it("leftover === amount is Non imputé, never Payé", () => {
    assert.equal(resolvePaymentStatus(150, 0, "Espèces", 150), UNALLOCATED_STATUS);
    assert.equal(resolvePaymentStatus(150, 0, "Espèces"), UNALLOCATED_STATUS);
    assert.equal(resolvePaymentStatus(150, 1000, "Espèces", 0), "Partiel");
    assert.equal(resolvePaymentStatus(150, 150, "Espèces", 0), "Payé");
    assert.equal(resolvePaymentStatus(150, 100, "Espèces", 50), "Payé");
  });

  it("GET presentation overrides stored Payé when nothing is allocated", () => {
    const projected = projectPaymentCash(
      { amount: 150, status: "Payé", overpaymentAmount: 150 },
      [],
    );
    assert.equal(projected.status, UNALLOCATED_STATUS);
    assert.equal(projected.allocatedAmount, 0);
    assert.equal(projected.unallocatedAmount, 150);
  });

  it("keeps Payé when allocations cover the receipt", () => {
    const projected = projectPaymentCash(
      { dbId: "pay-1", amount: 150, status: "Payé" },
      [{ paymentId: "pay-1", amount: 150, reversedAt: null }],
    );
    assert.equal(projected.status, "Payé");
    assert.equal(projected.unallocatedAmount, 0);
  });

  it("splits Encaissé / Imputé / Non imputé", () => {
    const payments = projectPaymentsWithAllocations(
      [
        { dbId: "a", amount: 150, status: "Payé" },
        { dbId: "b", amount: 200, status: "Payé" },
      ],
      [{ payment_id: "b", amount: 200 }],
    );
    const buckets = cashBucketsFromPayments(payments);
    assert.equal(buckets.collectedAmount, 350);
    assert.equal(buckets.allocatedAmount, 200);
    assert.equal(buckets.unallocatedAmount, 150);
  });
});
