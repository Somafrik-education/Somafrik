import type { StudentFee } from "../types";
import {
  filterParentDashboardRows,
  type ParentDashboardStudent,
} from "./parentDashboard";
import {
  formatPaymentOverviewAmounts,
  type PaymentAmountBucket,
} from "./paymentAmountBreakdown";
import {
  formatPaymentCashAmounts,
  type CashPaymentRow,
  type PaymentCashBucket,
} from "./paymentCashKpi";
import type { PaymentRecord } from "./quickPayment";

export type ParentFinanceModel = {
  fees: StudentFee[];
  payments: PaymentRecord[];
  expectedLabel: string;
  allocatedLabel: string;
  remainingLabel: string;
  collectedLabel: string;
  feeBuckets: PaymentAmountBucket[];
  cashBuckets: PaymentCashBucket[];
};

function paymentDateValue(row: PaymentRecord): number {
  return Date.parse(String(row.date ?? row.paidAt ?? row.createdAt ?? "")) || 0;
}

export function buildParentFinanceModel(input: {
  student: ParentDashboardStudent | null;
  studentFees: readonly StudentFee[];
  payments: readonly PaymentRecord[];
}): ParentFinanceModel {
  const fees = filterParentDashboardRows(
    input.studentFees as unknown as readonly Record<string, unknown>[],
    input.student,
  ) as unknown as StudentFee[];

  const payments = filterParentDashboardRows(
    input.payments as readonly Record<string, unknown>[],
    input.student,
  ) as PaymentRecord[];

  const feeSummary = formatPaymentOverviewAmounts(fees);
  const cashSummary = formatPaymentCashAmounts(payments as CashPaymentRow[]);

  return {
    fees,
    payments: [...payments].sort((left, right) => paymentDateValue(right) - paymentDateValue(left)),
    expectedLabel: feeSummary.expectedLabel,
    allocatedLabel: feeSummary.collectedLabel,
    remainingLabel: feeSummary.remainingLabel,
    collectedLabel: cashSummary.collectedLabel,
    feeBuckets: feeSummary.buckets,
    cashBuckets: cashSummary.buckets,
  };
}
