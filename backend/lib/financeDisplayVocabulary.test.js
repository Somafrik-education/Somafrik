"use strict";

/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 4 — décision #1041 : aucun « imputé » dans les messages
 * visibles. Les codes d'erreur, statuts HTTP et invariants comptables restent inchangés.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertPaymentConservation, INVARIANT_ERROR } = require("./financeDomainInvariants");

test("dépassement : message sans « imput », code et statut inchangés", () => {
  assert.throws(
    () => assertPaymentConservation({ amount: 100, allocations: [{ amount: 150 }] }),
    (error) =>
      error.statusCode === 400 &&
      error.code === INVARIANT_ERROR.CONSERVATION_VIOLATION &&
      !/imput/i.test(error.message) &&
      /affectés aux frais/.test(error.message),
  );
});

test("conservation : message sans « imput », invariant toujours appliqué", () => {
  assert.throws(
    () => assertPaymentConservation({ amount: 100, allocations: [{ amount: 40 }], unallocatedAmount: 10 }),
    (error) =>
      error.statusCode === 400 &&
      error.code === INVARIANT_ERROR.CONSERVATION_VIOLATION &&
      !/imput/i.test(error.message),
  );
  assert.deepEqual(
    assertPaymentConservation({ amount: 100, allocations: [{ amount: 40 }], unallocatedAmount: 60 }),
    { amount: 100, allocated: 40, unallocated: 60 },
  );
});
