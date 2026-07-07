import { useMemo } from "react";
import { useData } from "../../context/DataContext";
import { subscriptionReports } from "../../lib/subscriptionModule";
import { formatMetric } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";

export function SubscriptionReportsPage() {
  const { state } = useData();
  const stats = useMemo(() => subscriptionReports(state), [state]);

  const kpis = [
    { label: "Abonnements actifs", value: String(stats.activeCount) },
    { label: "En période d'essai", value: String(stats.trialCount) },
    { label: "En retard", value: String(stats.lateCount), tone: stats.lateCount ? "text-amber" : undefined },
    { label: "Suspendus", value: String(stats.suspendedCount), tone: stats.suspendedCount ? "text-danger" : undefined },
    {
      label: "Revenus mensuels (MRR)",
      value: formatMetric(stats.monthlyRevenue, "EUR"),
    },
    { label: "Paiements en attente", value: String(stats.pendingPayments) },
    { label: "Expiration sous 7 jours", value: String(stats.expiringSoon) },
    { label: "Conversion essai → actif", value: `${stats.conversionRate} %` },
    { label: "Offres actives", value: String(stats.offerCount) },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <SectionHeader
          title="Rapports abonnements"
          description="Vue consolidée pour le pilotage commercial Somafrik."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{kpi.label}</p>
              <p className={`mt-2 text-2xl font-black ${kpi.tone ?? "text-ink"}`}>{kpi.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader title="Indicateurs à suivre" description="Alignés sur la politique commerciale MVP." />
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>Chiffre d'affaires par pays et par offre (à connecter aux filtres pays)</li>
          <li>Taux de conversion essai → abonnement payant</li>
          <li>Établissements proches de l'expiration et à relancer</li>
          <li>Impayés et délais moyens de règlement</li>
        </ul>
      </Card>
    </div>
  );
}
