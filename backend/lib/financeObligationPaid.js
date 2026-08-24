"use strict";

/**
 * Lecture des montants encaissés depuis la vérité canonique :
 * colonnes obligation + payment_allocations actives.
 * GET ne persiste rien et n'attribue plus virtuellement un paiement non alloué.
 */

const { money, obligationStatus } = require("./financeManagement");

function remainingDue(fee) {
  return Math.max(0, money(fee.amountDue) - money(fee.exemption) - money(fee.amountPaid));
}

function isCancelledObligation(fee) {
  if (fee?.archivedAt || fee?.archived_at) return true;
  const status = String(fee?.status || "").trim().toLowerCase();
  return status === "annulé" || status === "annule" || status === "cancelled" || status === "canceled";
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

function projectObligationPaidAmounts({ fees, allocations = [] } = {}) {
  const allocatedByObligation = new Map();
  for (const allocation of allocations) {
    if (allocation.reversedAt || allocation.reversed_at) continue;
    const obligationId = String(allocation.obligationId || allocation.obligation_id || "");
    if (!obligationId) continue;
    allocatedByObligation.set(
      obligationId,
      money((allocatedByObligation.get(obligationId) || 0) + money(allocation.amount)),
    );
  }

  return (fees || []).map((fee) => {
    const fromAlloc = allocatedByObligation.get(String(fee.dbId || fee.id)) || 0;
    return withPaidAmount(fee, Math.max(money(fee.amountPaid), fromAlloc));
  });
}

module.exports = {
  projectObligationPaidAmounts,
  remainingDue,
};
