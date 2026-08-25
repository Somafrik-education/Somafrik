"use strict";

/**
 * Caisse vs créance.
 * Encaissé  = argent reçu (paiement compté, non annulé)
 * Imputé    = money affecté via payment_allocations
 * Non imputé = encaissé − imputé
 * leftover === amount → statut « Non imputé », jamais « Payé ».
 * 0 < imputé < encaissé → « Partiel », jamais « Payé ».
 * leftover === 0 → « Payé » ou « Partiel » selon la dette couverte.
 */

const { money, normalizeKey, isPaymentCancelled, isPaymentCounted } = require("./financeManagement");

const UNALLOCATED_STATUS = "Non imputé";
const PARTIAL_STATUS = "Partiel";

function allocatedAmountFrom(allocations = []) {
  return money(
    allocations
      .filter((row) => !row.reversedAt && !row.reversed_at)
      .reduce((sum, row) => sum + money(row.amount), 0),
  );
}

function unallocatedAmount(amount, allocated) {
  return Math.max(0, money(amount) - money(allocated));
}

function isUnallocatedStatus(status) {
  const key = normalizeKey(status);
  return key === "non impute" || key === "a imputer";
}

function isPendingCashStatus(status) {
  const key = normalizeKey(status);
  return key.includes("attente") || key === "pending";
}

function resolvePaymentStatus(amount, remainingBefore, method, leftover = 0) {
  if (normalizeKey(method) === "mobile money") return "En attente de confirmation";
  const total = money(amount);
  const rest = money(leftover);
  const allocated = money(total - rest);
  if (total > 0 && allocated === 0) return UNALLOCATED_STATUS;
  if (allocated > 0 && rest > 0) return PARTIAL_STATUS;
  if (money(remainingBefore) <= 0) return UNALLOCATED_STATUS;
  if (total >= money(remainingBefore)) return "Payé";
  return PARTIAL_STATUS;
}

function presentPaymentStatus(payment, allocated) {
  if (isPaymentCancelled(payment)) return "Annulé";
  if (isPendingCashStatus(payment?.status)) return payment.status;
  const leftover = unallocatedAmount(payment?.amount, allocated);
  const total = money(payment?.amount);
  if (total > 0 && leftover === total) return UNALLOCATED_STATUS;
  if (total > 0 && leftover > 0) return PARTIAL_STATUS;
  return payment?.status;
}

function projectPaymentCash(payment, allocations = []) {
  const allocated = allocatedAmountFrom(allocations);
  const unallocated = unallocatedAmount(payment?.amount, allocated);
  const status = presentPaymentStatus(payment, allocated);
  return {
    ...payment,
    allocatedAmount: allocated,
    unallocatedAmount: unallocated,
    overpaymentAmount: unallocated,
    status,
  };
}

function projectPaymentsWithAllocations(payments, allocations = []) {
  const byPayment = new Map();
  for (const row of allocations) {
    const key = String(row.paymentId || row.payment_id || "");
    if (!key) continue;
    const list = byPayment.get(key) || [];
    list.push(row);
    byPayment.set(key, list);
  }
  return (payments || []).map((payment) => {
    const keys = [payment.dbId, payment.id].map((value) => String(value ?? "")).filter(Boolean);
    const allocs = keys.flatMap((key) => byPayment.get(key) || []);
    const unique = [];
    const seen = new Set();
    for (const row of allocs) {
      const id = String(row.id || `${row.obligationId}:${row.amount}:${row.reversedAt || ""}`);
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(row);
    }
    return projectPaymentCash(payment, unique);
  });
}

function cashBucketsFromPayments(payments = []) {
  let collectedAmount = 0;
  let unallocatedAmountTotal = 0;
  let allocatedAmount = 0;
  for (const payment of payments) {
    if (!isPaymentCounted(payment)) continue;
    if (isPendingCashStatus(payment.status)) continue;
    const amount = money(payment.amount ?? payment.totalAmount);
    const unallocated = money(payment.unallocatedAmount ?? (isUnallocatedStatus(payment.status) ? amount : 0));
    collectedAmount += amount;
    unallocatedAmountTotal += unallocated;
    allocatedAmount += money(payment.allocatedAmount ?? Math.max(0, amount - unallocated));
  }
  return {
    collectedAmount: money(collectedAmount),
    allocatedAmount: money(allocatedAmount),
    unallocatedAmount: money(unallocatedAmountTotal),
  };
}

module.exports = {
  UNALLOCATED_STATUS,
  PARTIAL_STATUS,
  allocatedAmountFrom,
  unallocatedAmount,
  isUnallocatedStatus,
  resolvePaymentStatus,
  presentPaymentStatus,
  projectPaymentCash,
  projectPaymentsWithAllocations,
  cashBucketsFromPayments,
};
