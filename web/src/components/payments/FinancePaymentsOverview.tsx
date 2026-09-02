import { formatFinanceAmount } from "../../lib/financeCurrency";

type Props = {
  expectedAmount: number;
  collectedAmount: number;
  remainingAmount: number;
  obligationCount: number;
  recentPaymentCount: number;
  currency: string;
};

export function FinancePaymentsOverview({
  expectedAmount,
  collectedAmount,
  remainingAmount,
  obligationCount,
  recentPaymentCount,
  currency,
}: Props) {
  return (
    <section
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      aria-label="Synthèse financière"
    >
      <Kpi label="Montant attendu" value={formatFinanceAmount(expectedAmount, currency)} />
      <Kpi label="Montant encaissé" value={formatFinanceAmount(collectedAmount, currency)} />
      <Kpi label="Reste à payer" value={formatFinanceAmount(remainingAmount, currency)} />
      <Kpi label="Obligations" value={String(obligationCount)} />
      <Kpi label="Paiements récents" value={String(recentPaymentCount)} />
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-ink">{value}</p>
    </div>
  );
}
