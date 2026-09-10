import type { BackOfficeState, SessionUser } from "../types";
import { scopedStudentFees } from "./fees";
import { formatFinanceAmount, resolveFinanceCurrency } from "./financeCurrency";
import type { StudentFeeObligation } from "./paymentRateKpi";

export const PAYMENT_UNKNOWN_CURRENCY_LABEL = "Devise non renseignée";
export const PAYMENT_AMOUNT_UNAVAILABLE_LABEL = "—";

export type PaymentAmountBucket = {
  currencyKey: string;
  currencyLabel: string;
  expectedAmount: number;
  collectedAmount: number;
  remainingAmount: number;
};

export type FinancePaymentsOverviewModel = {
  expectedLabel: string;
  collectedLabel: string;
  remainingLabel: string;
  buckets: PaymentAmountBucket[];
  obligationCount: number;
  recentPaymentCount: number;
};

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function isCancelledObligation(fee: StudentFeeObligation): boolean {
  if (fee.archivedAt || fee.archived_at) return true;
  const status = normalizeKey(fee.status);
  return status === "annule" || status === "cancelled" || status === "canceled";
}

export function countActiveStudentFeeObligations(fees: readonly StudentFeeObligation[]): number {
  return fees.filter((fee) => !isCancelledObligation(fee)).length;
}

export function getPaymentAmountBreakdown(
  fees: readonly StudentFeeObligation[],
): PaymentAmountBucket[] {
  const grouped = new Map<string, { expectedAmount: number; collectedAmount: number }>();
  for (const fee of fees) {
    if (isCancelledObligation(fee)) continue;
    const due = parseMoney(fee.amountDue);
    const paid = parseMoney(fee.amountPaid);
    if (due == null || paid == null) continue;
    const exempt = parseMoney(fee.exemption) ?? 0;
    const expected = Math.max(0, due - exempt);
    const collected = Math.max(0, paid);
    const currencyKey = resolveFinanceCurrency(fee.currency);
    const current = grouped.get(currencyKey) ?? { expectedAmount: 0, collectedAmount: 0 };
    current.expectedAmount += expected;
    current.collectedAmount += collected;
    grouped.set(currencyKey, current);
  }

  return [...grouped.entries()]
    .map(([currencyKey, amounts]) => ({
      currencyKey,
      currencyLabel: currencyKey || PAYMENT_UNKNOWN_CURRENCY_LABEL,
      expectedAmount: amounts.expectedAmount,
      collectedAmount: amounts.collectedAmount,
      remainingAmount: Math.max(0, amounts.expectedAmount - amounts.collectedAmount),
    }))
    .sort((left, right) => {
      if (!left.currencyKey) return 1;
      if (!right.currencyKey) return -1;
      return left.currencyKey.localeCompare(right.currencyKey, "fr");
    });
}

export function formatPaymentAmountValue(amount: number, currencyKey: string): string {
  if (!currencyKey) {
    return `${new Intl.NumberFormat("fr-FR").format(amount)} · ${PAYMENT_UNKNOWN_CURRENCY_LABEL}`;
  }
  return formatFinanceAmount(amount, currencyKey);
}

function joinAmountLines(
  buckets: readonly PaymentAmountBucket[],
  pick: (bucket: PaymentAmountBucket) => number,
): string {
  if (!buckets.length) return PAYMENT_AMOUNT_UNAVAILABLE_LABEL;
  return buckets
    .map((bucket) => formatPaymentAmountValue(pick(bucket), bucket.currencyKey))
    .join("\n");
}

export function formatPaymentOverviewAmounts(fees: readonly StudentFeeObligation[]): {
  expectedLabel: string;
  collectedLabel: string;
  remainingLabel: string;
  buckets: PaymentAmountBucket[];
} {
  const buckets = getPaymentAmountBreakdown(fees);
  return {
    buckets,
    expectedLabel: joinAmountLines(buckets, (bucket) => bucket.expectedAmount),
    collectedLabel: joinAmountLines(buckets, (bucket) => bucket.collectedAmount),
    remainingLabel: joinAmountLines(buckets, (bucket) => bucket.remainingAmount),
  };
}

export function buildFinancePaymentsOverview(input: {
  user: SessionUser | null;
  state: BackOfficeState;
  recentPaymentCount: number;
}): FinancePaymentsOverviewModel {
  const fees = scopedStudentFees(input.user, input.state);
  const formatted = formatPaymentOverviewAmounts(fees);
  return {
    ...formatted,
    obligationCount: countActiveStudentFeeObligations(fees),
    recentPaymentCount: input.recentPaymentCount,
  };
}
