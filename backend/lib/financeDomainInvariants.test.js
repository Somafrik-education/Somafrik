"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  FINANCE_DOMAIN_CONCEPT,
  FORBIDDEN_CANONICAL_FEE_TYPES,
  INVARIANT_ERROR,
  computeAllocatedAmount,
  computeUnallocatedAmount,
  computeObligationPaidAmount,
  computeObligationBalance,
  isPaymentFinanciallyActive,
  assertPaymentConservation,
  assertValidAllocationAmount,
  assertCompatibleCurrency,
  assertAllocationTenant,
  assertNotCanonicalFeeType,
  obligationStatusFromBalance,
  canonicalStorageCurrency,
} = require("./financeDomainInvariants");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

function allocation({ amount, reversedAt = null, schoolId = SCHOOL_A } = {}) {
  return { schoolId, amount, reversedAt };
}

describe("F1 vocabulaire", () => {
  it("distingue FEE_TYPE / FEE_ITEM / FEE_OBLIGATION / PAYMENT / ALLOCATION", () => {
    assert.equal(FINANCE_DOMAIN_CONCEPT.FEE_TYPE, "FEE_TYPE");
    assert.equal(FINANCE_DOMAIN_CONCEPT.FEE_ITEM, "FEE_ITEM");
    assert.equal(FINANCE_DOMAIN_CONCEPT.FEE_OBLIGATION, "FEE_OBLIGATION");
    assert.equal(FINANCE_DOMAIN_CONCEPT.PAYMENT, "PAYMENT");
    assert.equal(FINANCE_DOMAIN_CONCEPT.PAYMENT_ALLOCATION, "PAYMENT_ALLOCATION");
    assert.equal(FINANCE_DOMAIN_CONCEPT.UNALLOCATED_AMOUNT, "UNALLOCATED_AMOUNT");
  });

  it("refuse Acompte comme type de frais canonique", () => {
    assert.ok(FORBIDDEN_CANONICAL_FEE_TYPES.includes("Acompte"));
    assert.throws(() => assertNotCanonicalFeeType("Acompte"), (error) => error.code === INVARIANT_ERROR.FORBIDDEN_FEE_TYPE);
    assert.doesNotThrow(() => assertNotCanonicalFeeType("Scolarité"));
  });

  it("FC n'est pas une devise de stockage", () => {
    assert.equal(canonicalStorageCurrency("FC"), "CDF");
    assert.equal(canonicalStorageCurrency("cdf"), "CDF");
  });
});

describe("SCÉNARIO A — dette 30000, paiement 30000", () => {
  it("balance 0 et unallocated 0", () => {
    const allocations = [allocation({ amount: 30000 })];
    const paid = computeObligationPaidAmount(allocations);
    const balance = computeObligationBalance({ amountDue: 30000, paidAmount: paid, exemptionAmount: 0 });
    const conserved = assertPaymentConservation({ amount: 30000, allocations });
    assert.equal(paid, 30000);
    assert.equal(balance, 0);
    assert.equal(conserved.unallocated, 0);
    assert.equal(obligationStatusFromBalance({ amountDue: 30000, paidAmount: paid }).status, "Payé");
  });
});

describe("SCÉNARIO B — dette 30000, paiement 10000", () => {
  it("balance 20000 partiel", () => {
    const allocations = [allocation({ amount: 10000 })];
    const paid = computeObligationPaidAmount(allocations);
    const balance = computeObligationBalance({ amountDue: 30000, paidAmount: paid });
    const conserved = assertPaymentConservation({ amount: 10000, allocations });
    assert.equal(balance, 20000);
    assert.equal(conserved.unallocated, 0);
    assert.equal(
      obligationStatusFromBalance({ amountDue: 30000, paidAmount: paid }).status,
      "Partiellement payé",
    );
  });
});

describe("SCÉNARIO C — dette 30000, paiement 50000", () => {
  it("balance 0 et unallocated 20000", () => {
    const allocations = [allocation({ amount: 30000 })];
    const paid = computeObligationPaidAmount(allocations);
    const balance = computeObligationBalance({ amountDue: 30000, paidAmount: paid });
    const conserved = assertPaymentConservation({ amount: 50000, allocations });
    assert.equal(balance, 0);
    assert.equal(conserved.allocated, 30000);
    assert.equal(conserved.unallocated, 20000);
    assert.equal(computeUnallocatedAmount(50000, 30000), 20000);
  });
});

describe("SCÉNARIO D — un paiement 50000, deux allocations", () => {
  it("1 paiement, 2 imputations, unallocated 0, reste global 0", () => {
    const allocations = [allocation({ amount: 30000 }), allocation({ amount: 20000 })];
    const conserved = assertPaymentConservation({ amount: 50000, allocations });
    assert.equal(conserved.allocated, 50000);
    assert.equal(conserved.unallocated, 0);
    const scolarite = computeObligationBalance({
      amountDue: 30000,
      paidAmount: computeObligationPaidAmount([allocations[0]]),
    });
    const examen = computeObligationBalance({
      amountDue: 20000,
      paidAmount: computeObligationPaidAmount([allocations[1]]),
    });
    assert.equal(scolarite, 0);
    assert.equal(examen, 0);
  });
});

describe("SCÉNARIO E — annulation", () => {
  it("allocations reversed : paid 0, dette réapparaît, paiement inactif mais auditable", () => {
    const live = [allocation({ amount: 30000 })];
    const reversed = [{ ...live[0], reversedAt: "2026-08-27T12:00:00.000Z" }];
    const payment = {
      amount: 30000,
      status: "Annulé",
      cancelledAt: "2026-08-27T12:00:00.000Z",
      schoolId: SCHOOL_A,
    };
    assert.equal(computeObligationPaidAmount(reversed), 0);
    assert.equal(computeObligationBalance({ amountDue: 30000, paidAmount: 0 }), 30000);
    assert.equal(isPaymentFinanciallyActive(payment), false);
    assert.equal(computeAllocatedAmount(reversed), 0);
    assert.ok(payment.cancelledAt, "le paiement reste persisté et auditable");
  });
});

describe("SCÉNARIO F — allocations > paiement", () => {
  it("refuse silencieusement impossible", () => {
    assert.throws(
      () => assertPaymentConservation({ amount: 50000, allocations: [allocation({ amount: 60000 })] }),
      (error) => error.code === INVARIANT_ERROR.CONSERVATION_VIOLATION,
    );
  });
});

describe("SCÉNARIO G — montants / devise invalides", () => {
  it("refuse allocation négative, NaN, devise incompatible", () => {
    assert.throws(() => assertValidAllocationAmount(-10), (error) => error.code === INVARIANT_ERROR.INVALID_AMOUNT);
    assert.throws(() => assertValidAllocationAmount(Number.NaN), (error) => error.code === INVARIANT_ERROR.INVALID_AMOUNT);
    assert.throws(
      () => assertCompatibleCurrency({ payment: { currency: "CDF" }, obligation: { currency: "USD" } }),
      (error) => error.code === INVARIANT_ERROR.CURRENCY_MISMATCH,
    );
    assert.equal(
      assertCompatibleCurrency({ payment: { currency: "FC" }, obligation: { currency: "CDF" } }),
      "CDF",
    );
  });
});

describe("cross-tenant", () => {
  it("refuse une allocation dont le schoolId diverge", () => {
    assert.throws(
      () =>
        assertAllocationTenant({
          payment: { schoolId: SCHOOL_A },
          allocation: { schoolId: SCHOOL_A, amount: 1000 },
          obligation: { schoolId: SCHOOL_B },
        }),
      (error) => error.code === INVARIANT_ERROR.TENANT_MISMATCH,
    );
    assert.equal(
      assertAllocationTenant({
        payment: { schoolId: SCHOOL_A },
        allocation: { schoolId: SCHOOL_A },
        obligation: { schoolId: SCHOOL_A },
      }),
      SCHOOL_A,
    );
    assert.throws(
      () =>
        assertAllocationTenant({
          payment: { schoolId: SCHOOL_A },
          allocation: { amount: 1000 },
          obligation: { schoolId: SCHOOL_A },
        }),
      (error) => error.code === INVARIANT_ERROR.TENANT_MISMATCH,
    );
  });
});

describe("discount hors formule V1", () => {
  it("n'applique pas discount au solde", () => {
    const balance = computeObligationBalance({
      amountDue: 30000,
      paidAmount: 0,
      exemptionAmount: 0,
      discount: 5000,
    });
    assert.equal(balance, 30000);
  });
});
