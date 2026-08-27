"use strict";

/**
 * F1 — Contrat métier Finance unique.
 * Fonctions pures : pas de DB, pas de HTTP, pas de React.
 *
 * Source normative :
 * docs/audits/go-prod-finance-business-domain-audit-2026-08-27.md
 *
 * Copies actuelles à remplacer plus tard (F4/F5) — ne pas en ajouter :
 * - web/src/lib/fees.ts computeStudentFeeStatus / studentFeeSummary
 * - web/src/lib/paymentRateKpi.ts
 * - web/src/lib/quickPayment.ts computeFeeBalance
 * - Mobile/src/lib/paymentRateKpi.ts
 * - Mobile/src/lib/paymentEnrollment.ts isOpenObligation
 * - Mobile/src/domain/metrics/schoolMetrics.ts getPaymentStats.rate
 */

const FINANCE_DOMAIN_CONCEPT = Object.freeze({
  FEE_TYPE: "FEE_TYPE",
  FEE_ITEM: "FEE_ITEM",
  FEE_OBLIGATION: "FEE_OBLIGATION",
  PAYMENT: "PAYMENT",
  PAYMENT_ALLOCATION: "PAYMENT_ALLOCATION",
  UNALLOCATED_AMOUNT: "UNALLOCATED_AMOUNT",
});

/** « Acompte » = allocation partielle, jamais un type de frais canonique. */
const FORBIDDEN_CANONICAL_FEE_TYPES = Object.freeze(["Acompte", "acompte", "ACOMPTE"]);

/** Présentation éventuelle ; jamais une devise de stockage. */
const PRESENTATION_CURRENCY_ALIASES = Object.freeze({
  FC: "CDF",
});

const INVARIANT_ERROR = Object.freeze({
  CONSERVATION_VIOLATION: "FINANCE_CONSERVATION_VIOLATION",
  INVALID_AMOUNT: "FINANCE_INVALID_AMOUNT",
  CURRENCY_MISMATCH: "FINANCE_CURRENCY_MISMATCH",
  TENANT_MISMATCH: "FINANCE_ALLOCATION_TENANT_MISMATCH",
  FORBIDDEN_FEE_TYPE: "FINANCE_FORBIDDEN_FEE_TYPE",
});

function createInvariantError(message, code, details) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toMoney(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function isReversedAllocation(allocation) {
  return Boolean(allocation?.reversedAt || allocation?.reversed_at);
}

function activeAllocations(allocations = []) {
  return (allocations || []).filter((row) => !isReversedAllocation(row));
}

function computeAllocatedAmount(allocations = []) {
  return toMoney(activeAllocations(allocations).reduce((sum, row) => sum + toMoney(row.amount), 0));
}

function computeUnallocatedAmount(paymentAmount, allocatedAmount) {
  return Math.max(0, toMoney(paymentAmount) - toMoney(allocatedAmount));
}

function computeObligationPaidAmount(allocations = []) {
  return computeAllocatedAmount(allocations);
}

/**
 * V1 : discount/réduction hors formule jusqu'à F3/F4.
 * balance = max(0, amountDue − paidAmount − exemptionAmount)
 */
function computeObligationBalance({ amountDue, paidAmount, exemptionAmount = 0 } = {}) {
  const due = toMoney(amountDue);
  const paid = toMoney(paidAmount);
  const exempt = toMoney(exemptionAmount);
  return Math.max(0, toMoney(due - paid - exempt));
}

function isPaymentFinanciallyActive(payment) {
  if (payment?.cancelledAt || payment?.cancelled_at) return false;
  const status = normalizeKey(payment?.status ?? payment?.payment_status);
  return status !== "annule" && status !== "cancelled" && status !== "canceled";
}

function assertPaymentConservation({ amount, allocations = [], unallocatedAmount } = {}) {
  const total = Number(amount);
  if (!Number.isFinite(total) || total < 0) {
    throw createInvariantError("Montant de paiement invalide.", INVARIANT_ERROR.INVALID_AMOUNT, { amount });
  }
  const allocated = computeAllocatedAmount(allocations);
  const expectedUnallocated = computeUnallocatedAmount(total, allocated);
  const reported =
    unallocatedAmount == null ? expectedUnallocated : toMoney(unallocatedAmount);
  if (allocated - toMoney(total) > 0.001) {
    throw createInvariantError(
      "Les imputations dépassent le paiement.",
      INVARIANT_ERROR.CONSERVATION_VIOLATION,
      { amount: toMoney(total), allocated, unallocated: reported },
    );
  }
  const conserved = toMoney(allocated + reported);
  if (Math.abs(conserved - toMoney(total)) > 0.001) {
    throw createInvariantError(
      "Conservation paiement violée : imputé + non imputé ≠ montant.",
      INVARIANT_ERROR.CONSERVATION_VIOLATION,
      { amount: toMoney(total), allocated, unallocated: reported },
    );
  }
  return { amount: toMoney(total), allocated, unallocated: expectedUnallocated };
}

function assertValidAllocationAmount(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw createInvariantError("Montant d'imputation invalide.", INVARIANT_ERROR.INVALID_AMOUNT, {
      amount,
    });
  }
  return toMoney(numeric);
}

function canonicalStorageCurrency(value) {
  const raw = asTrimmed(value).toUpperCase();
  if (!raw) return "";
  return PRESENTATION_CURRENCY_ALIASES[raw] || raw;
}

function assertCompatibleCurrency({ payment, obligation } = {}) {
  const left = canonicalStorageCurrency(payment?.currency);
  const right = canonicalStorageCurrency(obligation?.currency);
  if (!left || !right) return left || right;
  if (left !== right) {
    throw createInvariantError("Devise incompatible entre paiement et obligation.", INVARIANT_ERROR.CURRENCY_MISMATCH, {
      paymentCurrency: left,
      obligationCurrency: right,
    });
  }
  return left;
}

function entitySchoolId(entity) {
  return asTrimmed(entity?.schoolId || entity?.school_id);
}

function assertAllocationTenant({ payment, allocation, obligation } = {}) {
  const paymentSchool = entitySchoolId(payment);
  const allocationSchool = entitySchoolId(allocation);
  const obligationSchool = entitySchoolId(obligation);
  if (!paymentSchool || !allocationSchool || !obligationSchool) {
    throw createInvariantError(
      "schoolId requis sur paiement, imputation et obligation.",
      INVARIANT_ERROR.TENANT_MISMATCH,
      { paymentSchool, allocationSchool, obligationSchool },
    );
  }
  if (paymentSchool !== allocationSchool || allocationSchool !== obligationSchool) {
    throw createInvariantError(
      "Imputation cross-tenant interdite.",
      INVARIANT_ERROR.TENANT_MISMATCH,
      { paymentSchool, allocationSchool, obligationSchool },
    );
  }
  return paymentSchool;
}

function assertNotCanonicalFeeType(feeType) {
  const token = normalizeKey(feeType);
  if (FORBIDDEN_CANONICAL_FEE_TYPES.some((item) => normalizeKey(item) === token)) {
    throw createInvariantError(
      "Acompte n'est pas un type de frais. C'est une imputation partielle.",
      INVARIANT_ERROR.FORBIDDEN_FEE_TYPE,
      { feeType },
    );
  }
}

function obligationStatusFromBalance({ amountDue, paidAmount, exemptionAmount = 0, dueDate, now = new Date() } = {}) {
  const due = toMoney(amountDue);
  const paid = toMoney(paidAmount);
  const exempt = toMoney(exemptionAmount);
  const balance = computeObligationBalance({ amountDue: due, paidAmount: paid, exemptionAmount: exempt });
  if (exempt >= due && due > 0) return { balance, status: "Exonéré" };
  if (balance <= 0) return { balance: 0, status: "Payé" };
  if (paid > 0) return { balance, status: "Partiellement payé" };
  if (dueDate) {
    const dueMs = Date.parse(String(dueDate).includes("T") ? dueDate : `${dueDate}T00:00:00`);
    if (Number.isFinite(dueMs) && dueMs < now.getTime()) return { balance, status: "En retard" };
  }
  return { balance, status: "À payer" };
}

module.exports = {
  FINANCE_DOMAIN_CONCEPT,
  FORBIDDEN_CANONICAL_FEE_TYPES,
  PRESENTATION_CURRENCY_ALIASES,
  INVARIANT_ERROR,
  createInvariantError,
  toMoney,
  computeAllocatedAmount,
  computeUnallocatedAmount,
  computeObligationPaidAmount,
  computeObligationBalance,
  isPaymentFinanciallyActive,
  assertPaymentConservation,
  assertValidAllocationAmount,
  canonicalStorageCurrency,
  assertCompatibleCurrency,
  assertAllocationTenant,
  assertNotCanonicalFeeType,
  obligationStatusFromBalance,
  activeAllocations,
};
