import { isCancelledStatus, type CanonicalPayment } from "./dataTruth";
import { formatFinanceAmount, resolveFinanceCurrency } from "./financeCurrency";

export const CASH_UNKNOWN_CURRENCY_LABEL = "Devise non renseignée";
export const CASH_AMOUNT_UNAVAILABLE_LABEL = "—";

export type PaymentCashKpi = {
  collectedAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
};

export type CashPaymentRow = {
  amount?: number | string | null;
  totalAmount?: number | string | null;
  allocatedAmount?: number | string | null;
  unallocatedAmount?: number | string | null;
  status?: string | null;
  currency?: string | null;
};

export type PaymentCashBucket = {
  currencyKey: string;
  currencyLabel: string;
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

function parseMoney(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

/** Aligné sur le backend : encaissé = paiement compté et confirmé, jamais pending/refusé/échoué. */
export function isCountedMobileCashPayment(payment: Pick<CashPaymentRow, "status">): boolean {
  if (isCancelledStatus(payment.status ?? undefined)) return false;
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

export function getPaymentCashBreakdown(payments: readonly CashPaymentRow[]): PaymentCashBucket[] {
  const grouped = new Map<string, PaymentCashKpi>();
  for (const payment of payments) {
    if (!isCountedMobileCashPayment(payment)) continue;
    const collected = parseMoney(payment.amount ?? payment.totalAmount);
    const allocated = parseMoney(payment.allocatedAmount);
    const unallocated = parseMoney(payment.unallocatedAmount ?? 0);
    const currencyKey = resolveFinanceCurrency(payment.currency);
    const current = grouped.get(currencyKey) ?? {
      collectedAmount: 0,
      allocatedAmount: 0,
      unallocatedAmount: 0,
    };
    current.collectedAmount += collected;
    current.allocatedAmount += allocated;
    current.unallocatedAmount += unallocated;
    grouped.set(currencyKey, current);
  }

  return [...grouped.entries()]
    .map(([currencyKey, amounts]) => ({
      currencyKey,
      currencyLabel: currencyKey || CASH_UNKNOWN_CURRENCY_LABEL,
      ...amounts,
    }))
    .sort((left, right) => {
      if (!left.currencyKey) return 1;
      if (!right.currencyKey) return -1;
      return left.currencyKey.localeCompare(right.currencyKey, "fr");
    });
}

function joinCashLines(
  buckets: readonly PaymentCashBucket[],
  pick: (bucket: PaymentCashBucket) => number,
): string {
  if (!buckets.length) return CASH_AMOUNT_UNAVAILABLE_LABEL;
  return buckets
    .map((bucket) =>
      bucket.currencyKey
        ? formatFinanceAmount(pick(bucket), bucket.currencyKey)
        : `${new Intl.NumberFormat("fr-FR").format(pick(bucket))} · ${CASH_UNKNOWN_CURRENCY_LABEL}`,
    )
    .join("\n");
}

export function formatPaymentCashAmounts(payments: readonly CashPaymentRow[]): {
  collectedLabel: string;
  allocatedLabel: string;
  unallocatedLabel: string;
  buckets: PaymentCashBucket[];
} {
  const buckets = getPaymentCashBreakdown(payments);
  return {
    buckets,
    collectedLabel: joinCashLines(buckets, (bucket) => bucket.collectedAmount),
    allocatedLabel: joinCashLines(buckets, (bucket) => bucket.allocatedAmount),
    unallocatedLabel: joinCashLines(buckets, (bucket) => bucket.unallocatedAmount),
  };
}
