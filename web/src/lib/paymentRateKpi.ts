/**
 * KPI Accueil « Taux de paiement ».
 * Dénominateur = assiette canonique `student_fee_obligations` (GET /finance/student-fees).
 * Jamais le nombre de lignes de la table paiements : un seul encaissement ne crée pas l'assiette.
 * Contrat unique : Σ amountPaid / Σ (amountDue − exemption). Assiette non calculable → « — ».
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

function emptyKpi(): PaymentRateKpi {
  return {
    label: PAYMENT_RATE_KPI_LABEL,
    value: PAYMENT_RATE_PENDING_LABEL,
    rate: null,
    expectedAmount: 0,
    collectedAmount: 0,
  };
}

/**
 * Taux = montant encaissé / montant réellement attendu (hors exonération, hors annulé).
 * Fail-closed : une obligation active sans amountDue numérique → « — ».
 * Aucun repli headcount / statut Payé.
 */
export function getPaymentRateKpi(fees: readonly StudentFeeObligation[]): PaymentRateKpi {
  const active = fees.filter((fee) => !isCancelledObligation(fee));
  if (!active.length) return emptyKpi();

  let expectedAmount = 0;
  let collectedAmount = 0;
  for (const fee of active) {
    const due = parseMoney(fee.amountDue);
    if (due == null) return emptyKpi();
    const paid = parseMoney(fee.amountPaid);
    if (paid == null) return emptyKpi();
    const exempt = parseMoney(fee.exemption) ?? 0;
    expectedAmount += Math.max(0, due - exempt);
    collectedAmount += Math.max(0, paid);
  }

  if (expectedAmount <= 0) return emptyKpi();

  const bounded = Math.min(collectedAmount, expectedAmount);
  const rate = Math.round((bounded / expectedAmount) * 100);
  return {
    label: PAYMENT_RATE_KPI_LABEL,
    value: `${rate} %`,
    rate,
    expectedAmount,
    collectedAmount: bounded,
  };
}

export function formatPaymentRateKpi(fees: readonly StudentFeeObligation[]): {
  label: string;
  value: string;
} {
  const kpi = getPaymentRateKpi(fees);
  return { label: kpi.label, value: kpi.value };
}
