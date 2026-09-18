/**
 * F7 — formatage Finance Mobile.
 * Devise = contexte canonique établissement / pays / catalogue / ligne.
 * Jamais USD, EUR, CDF, FC en repli arbitraire.
 * Dates = JJ-MM-AAAA via formatDateForDisplay.
 */
import { formatDateForDisplay } from "./dates";

const PRESENTATION_ALIASES: Record<string, string> = {
  FC: "CDF",
};

export function resolveFinanceCurrency(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim().toUpperCase();
    if (!raw) continue;
    return PRESENTATION_ALIASES[raw] ?? raw;
  }
  return "";
}

export function formatFinanceAmount(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  const code = resolveFinanceCurrency(currency);
  if (!code) return "—";
  const numeric = Number(String(amount ?? "").replace(/\s/g, "").replace(",", "."));
  const value = Number.isFinite(numeric) ? numeric : 0;
  return `${new Intl.NumberFormat("fr-FR").format(value)} ${code}`;
}

export function formatFinanceDate(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return formatDateForDisplay(raw) || "—";
}
