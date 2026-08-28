import { isCancelledStatus, type CanonicalPayment } from "./dataTruth";

export type PaymentCashKpi = {
  collectedAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
};

function normalizedStatus(status: unknown): string {
  return String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Aligné sur le backend : encaissé = paiement compté et confirmé, jamais pending/refusé/échoué. */
export function isCountedMobileCashPayment(payment: CanonicalPayment): boolean {
  if (isCancelledStatus(payment.status)) return false;
  const status = normalizedStatus(payment.status);
  if (status.includes("attente") || status === "pending") return false;
  if (status === "refuse" || status === "echoue" || status === "failed") return false;
  return true;
}

/** Caisse : encaissé vs imputé vs non imputé, depuis GET /payments (pas les obligations). */
export function getPaymentCashKpi(payments: readonly CanonicalPayment[]): PaymentCashKpi {
  return payments.reduce(
    (acc, payment) => {
      if (!isCountedMobileCashPayment(payment)) return acc;
      const collected = Number(payment.amount ?? payment.totalAmount ?? 0);
      const allocated = Number(payment.allocatedAmount ?? 0);
      const unallocated = Number(payment.unallocatedAmount ?? 0);
      acc.collectedAmount += collected;
      acc.allocatedAmount += allocated;
      acc.unallocatedAmount += unallocated;
      return acc;
    },
    { collectedAmount: 0, allocatedAmount: 0, unallocatedAmount: 0 },
  );
}
