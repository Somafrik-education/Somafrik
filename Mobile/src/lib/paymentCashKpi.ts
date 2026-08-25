import { isCancelledStatus, type CanonicalPayment } from "./dataTruth";

export type PaymentCashKpi = {
  collectedAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
};

/** Caisse : encaissé vs imputé vs non imputé, depuis GET /payments (pas les obligations). */
export function getPaymentCashKpi(payments: readonly CanonicalPayment[]): PaymentCashKpi {
  return payments.reduce(
    (acc, payment) => {
      if (isCancelledStatus(payment.status)) return acc;
      const collected = Number(payment.amount ?? payment.totalAmount ?? 0);
      const allocated = Number(payment.allocatedAmount ?? 0);
      const unallocated = Number(
        payment.unallocatedAmount ?? Math.max(0, collected - allocated),
      );
      acc.collectedAmount += collected;
      acc.allocatedAmount += allocated;
      acc.unallocatedAmount += unallocated;
      return acc;
    },
    { collectedAmount: 0, allocatedAmount: 0, unallocatedAmount: 0 },
  );
}
