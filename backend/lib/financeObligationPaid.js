"use strict";

/**
 * Projection lecture des montants encaissés sur student_fee_obligations.
 * GET ne persiste rien : amountPaid exposé = max(colonne, allocations actives),
 * puis attribution en mémoire des paiements comptés sans allocation
 * (paiements historiques Scolarité ≠ Mensualité).
 */

const {
  money,
  isPaymentCounted,
  obligationStatus,
} = require("./financeManagement");
const { obligationMatchesPaymentFeeType } = require("./financeFeeTypeMatch");

function remainingDue(fee) {
  return Math.max(0, money(fee.amountDue) - money(fee.exemption) - money(fee.amountPaid));
}

function isCancelledObligation(fee) {
  if (fee?.archivedAt || fee?.archived_at) return true;
  const status = String(fee?.status || "").trim().toLowerCase();
  return status === "annulé" || status === "annule" || status === "cancelled" || status === "canceled";
}

function isOpenForAllocation(fee) {
  if (isCancelledObligation(fee)) return false;
  if (["Payé", "Exonéré"].includes(fee.status)) return false;
  return remainingDue(fee) > 0;
}

function withPaidAmount(fee, amountPaid) {
  const paid = money(amountPaid);
  if (paid === money(fee.amountPaid) && fee.balance != null) {
    return fee;
  }
  const next = obligationStatus({
    amountDue: fee.amountDue,
    amountPaid: paid,
    exemption: fee.exemption,
    dueDate: fee.dueDate,
  });
  return {
    ...fee,
    amountPaid: paid,
    balance: next.balance,
    status: isCancelledObligation(fee) ? "Annulé" : next.status,
  };
}

function indexFeesByStudent(fees) {
  const map = new Map();
  for (const fee of fees) {
    for (const key of [fee.studentId, fee.studentCode, fee.student_id].filter(Boolean).map(String)) {
      const list = map.get(key) || [];
      if (!list.includes(fee)) list.push(fee);
      map.set(key, list);
    }
  }
  return map;
}

function allocateOntoMatchingOpen(fees, amount, feeType) {
  let leftover = money(amount);
  const sorted = [...fees].sort((left, right) => remainingDue(right) - remainingDue(left));
  for (const fee of sorted) {
    if (leftover <= 0) break;
    if (!isOpenForAllocation(fee)) continue;
    if (!obligationMatchesPaymentFeeType(fee, feeType)) continue;
    const due = remainingDue(fee);
    const take = Math.min(due, leftover);
    const nextPaid = money(fee.amountPaid + take);
    const projected = withPaidAmount(fee, nextPaid);
    fee.amountPaid = projected.amountPaid;
    fee.balance = projected.balance;
    fee.status = projected.status;
    leftover = money(leftover - take);
  }
  return leftover;
}

function projectObligationPaidAmounts({ fees, payments = [], allocations = [], paymentItems = [] } = {}) {
  const allocatedByObligation = new Map();
  const allocatedPaymentIds = new Set();
  for (const allocation of allocations) {
    if (allocation.reversedAt || allocation.reversed_at) continue;
    const obligationId = String(allocation.obligationId || allocation.obligation_id || "");
    const paymentId = String(allocation.paymentId || allocation.payment_id || "");
    if (!obligationId) continue;
    allocatedByObligation.set(
      obligationId,
      money((allocatedByObligation.get(obligationId) || 0) + money(allocation.amount)),
    );
    if (paymentId) allocatedPaymentIds.add(paymentId);
  }

  const projected = (fees || []).map((fee) => {
    const fromAlloc = allocatedByObligation.get(String(fee.dbId || fee.id)) || 0;
    return withPaidAmount(fee, Math.max(money(fee.amountPaid), fromAlloc));
  });

  const itemsByPayment = new Map();
  for (const item of paymentItems) {
    const paymentId = String(item.paymentId || item.payment_id || "");
    if (!paymentId) continue;
    const list = itemsByPayment.get(paymentId) || [];
    list.push(item);
    itemsByPayment.set(paymentId, list);
  }

  const byStudent = indexFeesByStudent(projected);
  for (const payment of payments) {
    if (!isPaymentCounted(payment)) continue;
    const paymentDbId = String(payment.dbId || payment.id || "");
    if (paymentDbId && allocatedPaymentIds.has(paymentDbId)) continue;
    const studentFees =
      byStudent.get(String(payment.studentId || "")) ||
      byStudent.get(String(payment.studentCode || "")) ||
      [];
    if (!studentFees.length) continue;
    const items = itemsByPayment.get(paymentDbId);
    const chunks = items?.length
      ? items.map((item) => ({
          feeType: item.feeType || item.fee_type,
          amount: money(item.amount),
        }))
      : [{ feeType: payment.feeType || payment.label, amount: money(payment.amount) }];
    for (const chunk of chunks) {
      allocateOntoMatchingOpen(studentFees, chunk.amount, chunk.feeType);
    }
  }

  return projected;
}

module.exports = {
  projectObligationPaidAmounts,
  remainingDue,
};
