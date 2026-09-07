import { api } from "../api/client";
import type { SchoolFeeItem } from "../types";
import type { FinanceObligationProjection } from "./financePaymentWrite";

export interface FinancePaymentItem {
  id?: string;
  feeTypeId?: string | null;
  feeType: string;
  feeLabel?: string;
  amount: number;
  obligationId?: string;
}

export interface FinancePayment {
  id: string;
  reference: string;
  studentId: string;
  amount: number;
  totalAmount?: number;
  feeType: string;
  items?: FinancePaymentItem[];
  itemCount?: number;
  itemsDetail?: string;
  method: string;
  date: string;
  status: string;
  cancelReason?: string;
  overpaymentAmount?: number;
  allocatedAmount?: number;
  unallocatedAmount?: number;
  verificationCode?: string;
  receiptId?: string;
}

export interface FinanceFeeGrid {
  id: string;
  schoolId?: string;
  schoolCode?: string;
  classId?: string;
  classCode?: string;
  className: string;
  academicYear: string;
  periodName?: string;
  currency: string;
  status: string;
  items?: unknown[];
}

function mapCanonicalSchoolFeeItem(item: unknown, grid: FinanceFeeGrid): SchoolFeeItem {
  const row = (item ?? {}) as Record<string, unknown>;
  const status = String(row.status ?? "Actif") === "Désactivé" ? "Désactivé" : "Actif";
  const schoolId = String(row.schoolId ?? grid.schoolId ?? "").trim();
  return {
    id: String(row.id ?? ""),
    feeGridId: String(row.feeGridId ?? grid.id ?? ""),
    ...(schoolId ? { schoolId } : {}),
    schoolCode: String(row.schoolCode ?? grid.schoolCode ?? ""),
    className: String(row.className ?? grid.className ?? ""),
    feeType: String(row.feeType ?? "Autre"),
    label: String(row.label ?? ""),
    amount: Number(row.amount ?? 0),
    mandatory: row.mandatory !== false,
    dueDate: row.dueDate ? String(row.dueDate) : undefined,
    monthlyMonths: Array.isArray(row.monthlyMonths) ? row.monthlyMonths.map(String) : undefined,
    status,
  };
}

async function listSchoolFeeItemsFromCanonicalGrids(): Promise<SchoolFeeItem[]> {
  const grids = (await api.get<FinanceFeeGrid[]>("/finance/fee-grids")) ?? [];
  const details = await Promise.all(
    grids.map(async (grid) => {
      try {
        const detail = await api.get<{ grid?: FinanceFeeGrid; items?: unknown[] }>(
          `/finance/fee-grids/${encodeURIComponent(grid.id)}`,
        );
        const payload = detail && !Array.isArray(detail) ? detail : null;
        return {
          grid: payload?.grid ?? grid,
          items: Array.isArray(payload?.items) ? payload.items : [],
        };
      } catch {
        return { grid, items: [] as unknown[] };
      }
    }),
  );
  return details.flatMap((detail) =>
    (detail.items ?? []).map((item) => mapCanonicalSchoolFeeItem(item, detail.grid)),
  );
}

export interface PaymentStudentOption {
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  classId: string | null;
  classCode: string;
  className: string;
  studentStatus?: string;
  enrollmentStatus?: string;
  classes?: Array<{ classId: string; classCode: string; className: string }>;
}

export interface FinancePaymentMethod {
  id?: string | null;
  methodCode: string;
  label: string;
  active: boolean;
  sortOrder: number;
  persisted?: boolean;
}

export interface FinanceCatalogFeeType {
  itemId?: string | null;
  gridId?: string | null;
  feeType: string;
  label: string;
  amount: number;
  currency: string;
  classId?: string | null;
  classCode?: string;
  className?: string;
  academicYear?: string;
  dueDate?: string | null;
  periodLabel?: string;
  mandatory: boolean;
  active: boolean;
}

export interface FinanceCatalog {
  currency: string;
  currencySource: string;
  paymentMethods: FinancePaymentMethod[];
  feeTypes: FinanceCatalogFeeType[];
  canonicalFeeTypes: Array<{ feeType: string; label: string; code?: string; active?: boolean }>;
  feeTypeCatalog?: Array<{ code: string; feeType: string; label: string; active: boolean }>;
  discountsDeferred: boolean;
  penaltiesDeferred: boolean;
}

export const financeApi = {
  listPayments: () => api.get<FinancePayment[]>("/payments"),
  getPayment: (paymentId: string) =>
    api.get<FinancePayment>(`/payments/${encodeURIComponent(paymentId)}`),
  createPayment: (payload: Record<string, unknown>, options?: { idempotencyKey?: string }) =>
    api.post<FinancePayment>("/payments", payload, {
      headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    }),
  cancelPayment: (paymentId: string, reason: string, options?: { idempotencyKey?: string }) =>
    api.post<FinancePayment>(`/payments/${encodeURIComponent(paymentId)}/cancel`, { reason }, {
      headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    }),

  listPaymentStudentOptions: () =>
    api.get<PaymentStudentOption[]>("/finance/payment-student-options"),
  getFinanceCatalog: () => api.get<FinanceCatalog>("/finance/catalog"),
  listPaymentMethods: () => api.get<FinancePaymentMethod[]>("/finance/payment-methods"),
  replacePaymentMethods: (methods: FinancePaymentMethod[]) =>
    api.put<FinancePaymentMethod[]>("/finance/payment-methods", { methods }),

  listPaymentStatuses: () => api.get<unknown[]>("/finance/payment-statuses"),
  createPaymentStatus: (payload: Record<string, unknown>) =>
    api.post("/finance/payment-statuses", payload),
  patchPaymentStatus: (statusId: string, payload: Record<string, unknown>) =>
    api.patch(`/finance/payment-statuses/${encodeURIComponent(statusId)}`, payload),

  listFeeGrids: () => api.get<FinanceFeeGrid[]>("/finance/fee-grids"),
  createFeeGrid: (payload: Record<string, unknown>) =>
    api.post<FinanceFeeGrid>("/finance/fee-grids", payload),
  getFeeGrid: (gridId: string) =>
    api.get<{ grid: FinanceFeeGrid; items: unknown[] }>(`/finance/fee-grids/${encodeURIComponent(gridId)}`),
  listSchoolFeeItems: () => listSchoolFeeItemsFromCanonicalGrids(),
  updateFeeGrid: (gridId: string, payload: Record<string, unknown>) =>
    api.patch<FinanceFeeGrid>(`/finance/fee-grids/${encodeURIComponent(gridId)}`, payload),
  activateFeeGrid: (gridId: string) =>
    api.post<FinanceFeeGrid>(`/finance/fee-grids/${encodeURIComponent(gridId)}/activate`),
  deactivateFeeGrid: (gridId: string) =>
    api.post<FinanceFeeGrid>(`/finance/fee-grids/${encodeURIComponent(gridId)}/deactivate`),
  applyFeeGrid: (
    gridId: string,
    payload: Record<string, unknown> = {},
    options?: { idempotencyKey?: string },
  ) =>
    api.post<{ created: number; skipped: number }>(
      `/finance/fee-grids/${encodeURIComponent(gridId)}/apply`,
      payload,
      {
        headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      },
    ),

  listStudentFees: () => api.get<FinanceObligationProjection[]>("/finance/student-fees"),
  getStudentFee: (obligationId: string) =>
    api.get(`/finance/student-fees/${encodeURIComponent(obligationId)}`),
  adjustStudentFee: (obligationId: string, payload: Record<string, unknown>) =>
    api.post(`/finance/student-fees/${encodeURIComponent(obligationId)}/adjust`, payload),

  listUnpaid: (query = "") => api.get(`/backoffice/finance/unpaid${query}`),
  getUnpaidStudent: (studentId: string) =>
    api.get(`/backoffice/finance/unpaid/${encodeURIComponent(studentId)}`),
  createReminder: (
    studentId: string,
    payload: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ) =>
    api.post(`/backoffice/finance/unpaid/${encodeURIComponent(studentId)}/reminders`, payload, {
      headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    }),
};
