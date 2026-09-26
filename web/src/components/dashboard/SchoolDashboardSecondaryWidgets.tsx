import { DonutChart } from "../charts/DashboardCharts";
import { CHART_PALETTE } from "../../lib/chartTheme";
import type { TodayPresenceKpi } from "../../lib/presenceMetrics";

export function SchoolDashboardSecondaryWidgets({
  levels,
  attendance,
  showLevels,
  showAttendance,
}: {
  levels: Array<{ name: string; value: number }>;
  attendance: TodayPresenceKpi;
  showLevels: boolean;
  showAttendance: boolean;
}) {
  if (!showLevels && !showAttendance) return null;
  return (
    <section className="grid min-w-0 items-stretch gap-2 md:grid-cols-2" aria-label="Indicateurs complémentaires">
      {showLevels ? (
        <article className="flex min-w-0 flex-col rounded-xl border border-line bg-white p-3 shadow-sm">
          <h2 className="text-sm font-bold text-ink sm:text-base">Élèves par niveau</h2>
          <p className="sr-only">Effectifs de l'établissement selon les niveaux renseignés.</p>
          {levels.length ? (
            <>
              <div className="mx-auto mt-1 h-24 w-full max-w-[130px] min-w-0 sm:h-28" role="img" aria-label="Répartition des élèves par niveau">
                <DonutChart innerRadius={27} outerRadius={43} showLegend={false} data={levels.map((item, index) => ({
                  ...item,
                  fill: CHART_PALETTE[index % CHART_PALETTE.length],
                }))} />
              </div>
              <ul className="mt-1 space-y-1 text-xs" aria-label="Effectifs par niveau">
                {levels.map((item, index) => (
                  <li key={item.name} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_PALETTE[index % CHART_PALETTE.length] }} />
                      <span className="break-words text-ink">{item.name}</span>
                    </span>
                    <strong className="shrink-0 tabular-nums text-ink">{item.value.toLocaleString("fr-FR")}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="mt-6 text-sm text-muted">Aucun élève à répartir.</p>}
        </article>
      ) : null}
      {showAttendance ? (
        <article className="flex min-w-0 flex-col rounded-xl border border-line bg-white p-3 shadow-sm">
          <h2 className="text-sm font-bold text-ink sm:text-base">Présence du jour</h2>
          <p className="sr-only">Présents et retards comptés comme ayant assisté. Les absences justifiées restent des absences.</p>
          <div className="mt-1 flex flex-1 flex-col items-center justify-center gap-1 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full p-2 sm:h-28 sm:w-28" style={{ background: attendance.rate === null ? "#e2e8f0" : `conic-gradient(#16a34a ${attendance.rate}%, #e2e8f0 0)` }}>
              <div className="flex h-full w-full items-center justify-center rounded-full bg-white">
                <p className="text-xl font-black tabular-nums text-ink sm:text-2xl">{attendance.value}</p>
              </div>
            </div>
            <p className="text-xs text-muted">
              {attendance.recorded.toLocaleString("fr-FR")} appels enregistrés sur {attendance.expected.toLocaleString("fr-FR")} élèves attendus
            </p>
            {attendance.rate !== null ? (
              <div className="w-full max-w-sm">
                <div role="progressbar" aria-label="Taux de présence du jour" aria-valuemin={0} aria-valuemax={100} aria-valuenow={attendance.rate} className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${attendance.rate}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">{attendance.attended} élèves présents ou en retard</p>
              </div>
            ) : (
              <p className="max-w-xs text-sm text-muted">
                {attendance.expected === 0 ? "Aucun élève attendu aujourd'hui." : "Appel incomplet : le taux sera disponible lorsque tous les élèves attendus auront été pointés."}
              </p>
            )}
          </div>
        </article>
      ) : null}
    </section>
  );
}
