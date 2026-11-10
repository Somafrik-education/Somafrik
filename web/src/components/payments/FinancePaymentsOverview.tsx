type Props = {
  expectedLabel: string;
  cashLabel: string;
  allocatedLabel: string;
  remainingLabel: string;
  obligationCount: number;
  recentPaymentCount: number;
};

export function FinancePaymentsOverview({
  expectedLabel,
  cashLabel,
  remainingLabel,
}: Props) {
  return (
    <section
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Synthèse financière"
    >
      <Kpi label="Obligation" value={expectedLabel} />
      <Kpi label="Encaissé" value={cashLabel} />
      <Kpi label="Reste à payer" value={remainingLabel} />
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-ink whitespace-pre-line">{value}</p>
    </div>
  );
}
