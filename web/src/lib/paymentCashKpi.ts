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
  unallocatedAmount: number | null;
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

/** Canonique GET /payments : absent/invalide → null, jamais inféré côté client. */
function readCanonicalUnallocated(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

export function isCountedCashPayment(payment: Pick<CashPaymentRow, "status">): boolean {
  const status = normalizedStatus(payment.status);
  if (status.includes("annul") || status.includes("cancel")) return false;
  if (status.includes("attente") || status === "pending") return false;
  if (status === "refuse" || status === "echoue" || status === "failed" || status.includes("brouillon")) {
    return false;
  }
  return true;
}

export function getPaymentCashBreakdown(payments: readonly CashPaymentRow[]): PaymentCashBucket[] {
  const grouped = new Map<string, Omit<PaymentCashBucket, "currencyKey" | "currencyLabel">>();
  for (const payment of payments) {
    if (!isCountedCashPayment(payment)) continue;
    const collected = parseMoney(payment.amount ?? payment.totalAmount);
    const allocated = parseMoney(payment.allocatedAmount);
    const unallocated = readCanonicalUnallocated(payment.unallocatedAmount);
    const currencyKey = resolveFinanceCurrency(payment.currency);
    const current = grouped.get(currencyKey) ?? {
      collectedAmount: 0,
      allocatedAmount: 0,
      unallocatedAmount: 0 as number | null,
    };
    current.collectedAmount += collected;
    current.allocatedAmount += allocated;
    if (unallocated == null || current.unallocatedAmount == null) {
      current.unallocatedAmount = null;
    } else {
      current.unallocatedAmount += unallocated;
    }
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
  const unallocatedKnown = buckets.every((bucket) => bucket.unallocatedAmount != null);
  return {
    buckets,
    collectedLabel: joinCashLines(buckets, (bucket) => bucket.collectedAmount),
    allocatedLabel: joinCashLines(buckets, (bucket) => bucket.allocatedAmount),
    unallocatedLabel: unallocatedKnown
      ? joinCashLines(buckets, (bucket) => bucket.unallocatedAmount ?? 0)
      : CASH_AMOUNT_UNAVAILABLE_LABEL,
  };
}
