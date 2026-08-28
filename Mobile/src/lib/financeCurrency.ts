/**
 * F7 — formatage Finance Mobile.
 * Devise = contexte canonique établissement / pays / catalogue / ligne.
 * Jamais USD, EUR, CDF, FC en repli arbitraire.
 */

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
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (dmy) return `${dmy[1]}/${dmy[2]}/${dmy[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(parsed));
}
