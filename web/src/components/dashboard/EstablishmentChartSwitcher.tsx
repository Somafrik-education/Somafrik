import { useEffect, useState } from "react";
import type { EstablishmentChart } from "../../lib/dashboardCharts";
import type { DashboardPeriodContext } from "../../lib/dashboardChartPeriod";
import { DashboardChartGrid } from "../charts/DashboardChartGrid";

/** LOT 2: a single central chart; only charts already authorized for this role are offered. */
export function EstablishmentChartSwitcher({
  charts,
  periodContext,
  orderUserKey,
  showTypeBadge,
}: {
  charts: EstablishmentChart[];
  periodContext: DashboardPeriodContext;
  orderUserKey?: string;
  showTypeBadge: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(() => charts[0]?.id ?? "");

  useEffect(() => {
    if (!charts.some((chart) => chart.id === selectedId)) {
      setSelectedId(charts[0]?.id ?? "");
    }
  }, [charts, selectedId]);

  const selectedChart = charts.find((chart) => chart.id === selectedId) ?? charts[0];

  if (!selectedChart) {
    return (
      <section aria-label="Graphique métier" className="rounded-xl border border-dashed border-line bg-slate-50 p-6 text-sm text-muted">
        Aucun graphique disponible pour votre rôle dans cet établissement.
      </section>
    );
  }

  return (
    <section aria-label="Graphique métier" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">Graphique métier</h2>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Indicateur
          <select
            value={selectedChart.id}
            onChange={(event) => setSelectedId(event.target.value)}
            aria-label="Choisir le graphique métier"
            className="min-w-[12rem] rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            {charts.map((chart) => (
              <option key={chart.id} value={chart.id}>{chart.title}</option>
            ))}
          </select>
        </label>
      </div>
      <DashboardChartGrid
        charts={[selectedChart]}
        periodContext={periodContext}
        orderScope="establishment"
        orderUserKey={orderUserKey}
        showTypeBadge={showTypeBadge}
      />
    </section>
  );
}
