import { api } from "../api/client";

export interface FinancePaymentItem {
  id?: string;
  feeTypeId?: string | null;
  feeType: string;
  feeLabel?: string;
  amount: number;
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
  verificationCode?: string;
  receiptId?: string;
}

export interface FinanceFeeGrid {
  id: string;
  className: string;
  academicYear: string;
  periodName?: string;
  currency: string;
  status: string;
  items?: unknown[];
}

export const financeApi = {
  listPayments: () => api.get<FinancePayment[]>("/payments"),
  getPayment: (paymentId: string) =>
    api.get<FinancePayment>(`/payments/${encodeURIComponent(paymentId)}`),
  createPayment: (payload: Record<string, unknown>) =>
    api.post<FinancePayment>("/payments", payload),
  cancelPayment: (paymentId: string, reason: string) =>
    api.post<FinancePayment>(`/payments/${encodeURIComponent(paymentId)}/cancel`, { reason }),

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
  updateFeeGrid: (gridId: string, payload: Record<string, unknown>) =>
    api.patch<FinanceFeeGrid>(`/finance/fee-grids/${encodeURIComponent(gridId)}`, payload),
  activateFeeGrid: (gridId: string) =>
    api.post<FinanceFeeGrid>(`/finance/fee-grids/${encodeURIComponent(gridId)}/activate`),
  deactivateFeeGrid: (gridId: string) =>
    api.post<FinanceFeeGrid>(`/finance/fee-grids/${encodeURIComponent(gridId)}/deactivate`),
  applyFeeGrid: (gridId: string, payload: Record<string, unknown> = {}) =>
    api.post<{ created: number; skipped: number }>(
      `/finance/fee-grids/${encodeURIComponent(gridId)}/apply`,
      payload,
    ),

  listStudentFees: () => api.get<unknown[]>("/finance/student-fees"),
  getStudentFee: (obligationId: string) =>
    api.get(`/finance/student-fees/${encodeURIComponent(obligationId)}`),
  adjustStudentFee: (obligationId: string, payload: Record<string, unknown>) =>
    api.post(`/finance/student-fees/${encodeURIComponent(obligationId)}/adjust`, payload),

  listUnpaid: (query = "") => api.get(`/backoffice/finance/unpaid${query}`),
  getUnpaidStudent: (studentId: string) =>
    api.get(`/backoffice/finance/unpaid/${encodeURIComponent(studentId)}`),
  createReminder: (studentId: string, payload: Record<string, unknown>) =>
    api.post(`/backoffice/finance/unpaid/${encodeURIComponent(studentId)}/reminders`, payload),
};
