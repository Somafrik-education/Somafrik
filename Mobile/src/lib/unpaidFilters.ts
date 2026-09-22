import { normalize } from "./format";

export type UnpaidRowFilters = {
  search?: string;
  className?: string;
  period?: string;
};

export const UNPAID_UNKNOWN_CURRENCY_LABEL = "Devise non renseignée";

/** Filtre les lignes ledger déjà agrégées. Jamais de recalcul de solde. */
export function filterUnpaidRows<
  T extends {
    studentName?: string;
    studentId?: string;
    matricule?: string;
    className?: string;
    periodLabel?: string;
  },
>(rows: T[], filters: UnpaidRowFilters = {}): T[] {
  return rows.filter((row) => {
    if (filters.className && normalize(row.className) !== normalize(filters.className)) return false;
    if (filters.period && normalize(row.periodLabel ?? "") !== normalize(filters.period)) return false;
    if (filters.search) {
      const q = normalize(filters.search);
      const haystack = [row.studentName, row.studentId, row.matricule, row.className, row.periodLabel]
        .map((value) => normalize(value))
        .join(" ");
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Totaux par devise à partir de `amountDue` DTO.
 * Jamais de somme unique si plusieurs devises ou devise absente.
 */
export function unpaidTotalsByCurrency(
  rows: Array<{ amountDue: number; currency?: string }>,
): { totalsByCurrency: Array<{ currency: string; amount: number }>; totalAmountDue: number; currency: string } {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const currency = String(row.currency ?? "").trim().toUpperCase();
    grouped.set(currency, (grouped.get(currency) ?? 0) + Number(row.amountDue ?? 0));
  }
  const totalsByCurrency = [...grouped.entries()]
    .map(([currency, amount]) => ({
      currency: currency || UNPAID_UNKNOWN_CURRENCY_LABEL,
      amount,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency, "fr"));
  const known = totalsByCurrency.filter((item) => item.currency !== UNPAID_UNKNOWN_CURRENCY_LABEL);
  const hasUnknown = known.length !== totalsByCurrency.length;
  if (known.length !== 1 || hasUnknown) {
    return { totalsByCurrency, totalAmountDue: 0, currency: "" };
  }
  return {
    totalsByCurrency,
    totalAmountDue: known[0]?.amount ?? 0,
    currency: known[0]?.currency ?? "",
  };
}

export function classOptionsFromUnpaid(rows: Array<{ className?: string }>): string[] {
  return [...new Set(rows.map((row) => String(row.className ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

export function periodOptionsFromUnpaid(rows: Array<{ periodLabel?: string }>): string[] {
  return periodOptionsFromFees(rows);
}

/** Options T1/T2 depuis les fees DTO, jamais depuis « Plusieurs périodes ». */
export function periodOptionsFromFees(
  fees: Array<{ periodLabel?: string; academicYear?: string }>,
): string[] {
  return [
    ...new Set(
      fees.flatMap((fee) => [fee.periodLabel, fee.academicYear].filter(Boolean) as string[]),
    ),
  ]
    .map((value) => value.trim())
    .filter((value) => value && value !== "Plusieurs périodes" && value !== "—")
    .sort((a, b) => a.localeCompare(b, "fr"));
}
