/**
 * FIN-L3-06 — fixture HYPOTHÉTIQUE client-only.
 *
 * CE N'EST PAS un dump préprod live.
 * CE N'EST PAS le payload final GET /payments de develop actuel.
 *
 * Sur le chemin réel GET /api/payments → listFinanceProjection →
 * decoratePaymentWithItems(), si items.length > 0 alors
 * API amount = API totalAmount = SUM(items). Un couple
 * amount=754250 / SUM(items)=754450 ne survit pas à ce décorateur :
 * le JSON sortant aurait amount=754450.
 *
 * Cette fixture sert uniquement à verrouiller le comportement client
 * SI un payload brut (avant décoration) présentait cette divergence.
 */

export type FinL306PaymentItem = {
  feeLabel?: string;
  amount: number;
};

export type FinL306PaymentRow = {
  id: string;
  publicId: string;
  reference: string;
  studentId: string;
  studentName?: string;
  status: string;
  currency: string;
  amount: number;
  totalAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  items: FinL306PaymentItem[];
};

export const FIN_L306_DIVERGENT_COUNTED_ID = "FIX-L306-CDF-COUNTED";

/** Hypothèse pre-décoration : persisté 754250, items 754450. GET actuel écraserait amount à 754450. */
export const FIN_L306_DIVERGENT_COUNTED: FinL306PaymentRow = {
  id: FIN_L306_DIVERGENT_COUNTED_ID,
  publicId: FIN_L306_DIVERGENT_COUNTED_ID,
  reference: FIN_L306_DIVERGENT_COUNTED_ID,
  studentId: "FIX-L306-STU-1",
  studentName: "Fixture L3-06 (pas un élève préprod)",
  status: "Payé",
  currency: "CDF",
  amount: 754_250,
  totalAmount: 754_250,
  allocatedAmount: 754_250,
  unallocatedAmount: 0,
  items: [
    { feeLabel: "Minerval", amount: 754_250 },
    { feeLabel: "Ligne items non reflétée dans amount", amount: 200 },
  ],
};

/** Brouillon 200 CDF — exclu Web et Mobile (FIN-L3-05-B). */
export const FIN_L306_DRAFT_200: FinL306PaymentRow = {
  id: "FIX-L306-CDF-DRAFT",
  publicId: "FIX-L306-CDF-DRAFT",
  reference: "FIX-L306-CDF-DRAFT",
  studentId: "FIX-L306-STU-2",
  studentName: "Fixture brouillon L3-06",
  status: "Brouillon",
  currency: "CDF",
  amount: 200,
  totalAmount: 200,
  allocatedAmount: 0,
  unallocatedAmount: 200,
  items: [{ feeLabel: "Brouillon", amount: 200 }],
};

export const FIN_L306_USD_COUNTED: FinL306PaymentRow = {
  id: "FIX-L306-USD-COUNTED",
  publicId: "FIX-L306-USD-COUNTED",
  reference: "FIX-L306-USD-COUNTED",
  studentId: "FIX-L306-STU-3",
  studentName: "Fixture USD L3-06",
  status: "Payé",
  currency: "USD",
  amount: 50,
  totalAmount: 50,
  allocatedAmount: 50,
  unallocatedAmount: 0,
  items: [{ feeLabel: "Minerval USD", amount: 50 }],
};

/** Ledger façon préprod : un compté CDF divergent + brouillon + USD. */
export const FIN_L306_LEDGER: FinL306PaymentRow[] = [
  FIN_L306_DIVERGENT_COUNTED,
  FIN_L306_DRAFT_200,
  FIN_L306_USD_COUNTED,
];

export function sumPaymentItems(row: { items?: Array<{ amount?: number | null }> | null }): number {
  return (row.items ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

export type FinL306AuditRow = {
  id: string;
  publicId: string;
  reference: string;
  studentId: string;
  studentName: string;
  status: string;
  currency: string;
  amount: number;
  totalAmount: number;
  sumItems: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  itemCount: number;
  items: FinL306PaymentItem[];
  difference: number;
  countedWeb: boolean;
  countedMobile: boolean;
};

function countedByStatus(status: string): boolean {
  const value = String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (value.includes("annul") || value.includes("cancel")) return false;
  if (value.includes("attente") || value === "pending") return false;
  if (value === "refuse" || value === "echoue" || value === "failed" || value.includes("brouillon")) {
    return false;
  }
  return true;
}

export function auditPaymentAmountVsItems(rows: FinL306PaymentRow[]): FinL306AuditRow[] {
  return rows
    .map((row) => {
      const sumItems = sumPaymentItems(row);
      const counted = countedByStatus(row.status);
      return {
        id: row.id,
        publicId: row.publicId,
        reference: row.reference,
        studentId: row.studentId,
        studentName: row.studentName ?? "",
        status: row.status,
        currency: row.currency,
        amount: row.amount,
        totalAmount: row.totalAmount,
        sumItems,
        allocatedAmount: row.allocatedAmount,
        unallocatedAmount: row.unallocatedAmount,
        itemCount: row.items.length,
        items: row.items,
        difference: sumItems - Number(row.amount),
        countedWeb: counted,
        countedMobile: counted,
      };
    })
    .filter((row) => row.amount !== row.totalAmount || row.amount !== row.sumItems);
}

export function webCountedAmount(rows: FinL306PaymentRow[], currency: string): number {
  return rows
    .filter((row) => countedByStatus(row.status) && row.currency === currency)
    .reduce((sum, row) => sum + Number(row.amount), 0);
}

export function mobileItemsCountedAmount(rows: FinL306PaymentRow[], currency: string): number {
  return rows
    .filter((row) => countedByStatus(row.status) && row.currency === currency)
    .reduce((sum, row) => sum + sumPaymentItems(row), 0);
}
