/**
 * KPI Accueil « Taux de paiement ».
 * Dénominateur = assiette canonique `student_fee_obligations` (GET /finance/student-fees).
 * Jamais `payments.length` : une seule ligne de paiement ne crée pas l'assiette.
 * Aucune assiette attendue → « — », pas 0 % (0 % = dette connue, rien encaissé).
 */
export const PAYMENT_RATE_KPI_LABEL = "Taux de paiement";
export const PAYMENT_RATE_PENDING_LABEL = "—";

export type StudentFeeObligation = {
  studentId?: string | null;
  amountDue?: number | string | null;
  amountPaid?: number | string | null;
  exemption?: number | string | null;
  status?: string | null;
  archivedAt?: string | null;
  archived_at?: string | null;
};

export type PaymentRateKpi = {
  label: string;
  value: string;
  rate: number | null;
  expectedAmount: number;
  collectedAmount: number;
  expectedStudents: number;
  paidStudents: number;
};

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function money(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function isCancelledObligation(fee: StudentFeeObligation): boolean {
  if (fee.archivedAt || fee.archived_at) return true;
  const status = normalizeKey(fee.status);
  return status === "annule" || status === "cancelled" || status === "canceled";
}

function isPaidObligationStatus(status?: string | null): boolean {
  const key = normalizeKey(status);
  return key === "paye" || key === "paid";
}

function emptyKpi(): PaymentRateKpi {
  return {
    label: PAYMENT_RATE_KPI_LABEL,
    value: PAYMENT_RATE_PENDING_LABEL,
    rate: null,
    expectedAmount: 0,
    collectedAmount: 0,
    expectedStudents: 0,
    paidStudents: 0,
  };
}

/**
 * Taux = montant encaissé / montant réellement attendu (hors exonération, hors annulé).
 * Si les montants ne sont pas calculables, repli headcount élèves facturables.
 * Si aucune assiette n'existe : « — ».
 */
export function getPaymentRateKpi(fees: readonly StudentFeeObligation[]): PaymentRateKpi {
  const active = fees.filter((fee) => !isCancelledObligation(fee));
  if (!active.length) return emptyKpi();

  let expectedAmount = 0;
  let collectedAmount = 0;
  let hasNumericDue = false;
  for (const fee of active) {
    if (fee.amountDue == null || fee.amountDue === "") continue;
    const due = Number(fee.amountDue);
    if (!Number.isFinite(due)) continue;
    hasNumericDue = true;
    const net = Math.max(0, due - money(fee.exemption));
    expectedAmount += net;
    collectedAmount += Math.max(0, money(fee.amountPaid));
  }

  if (hasNumericDue) {
    if (expectedAmount <= 0) return emptyKpi();
    const bounded = Math.min(collectedAmount, expectedAmount);
    const rate = Math.round((bounded / expectedAmount) * 100);
    return {
      label: PAYMENT_RATE_KPI_LABEL,
      value: `${rate} %`,
      rate,
      expectedAmount,
      collectedAmount: bounded,
      expectedStudents: 0,
      paidStudents: 0,
    };
  }

  const byStudent = new Map<string, StudentFeeObligation[]>();
  for (const fee of active) {
    const id = String(fee.studentId ?? "").trim();
    if (!id) continue;
    const list = byStudent.get(id) ?? [];
    list.push(fee);
    byStudent.set(id, list);
  }

  if (!byStudent.size) return emptyKpi();

  let paidStudents = 0;
  for (const obligations of byStudent.values()) {
    const allPaid = obligations.every((fee) => isPaidObligationStatus(fee.status));
    if (allPaid) paidStudents += 1;
  }
  const rate = Math.round((paidStudents / byStudent.size) * 100);
  return {
    label: PAYMENT_RATE_KPI_LABEL,
    value: `${rate} %`,
    rate,
    expectedAmount: 0,
    collectedAmount: 0,
    expectedStudents: byStudent.size,
    paidStudents,
  };
}

export function formatPaymentRateKpi(fees: readonly StudentFeeObligation[]): {
  label: string;
  value: string;
} {
  const kpi = getPaymentRateKpi(fees);
  return { label: kpi.label, value: kpi.value };
}
