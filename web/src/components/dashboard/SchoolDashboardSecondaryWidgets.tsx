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
    <section className="grid min-w-0 gap-4 md:grid-cols-2" aria-label="Indicateurs complémentaires">
      {showLevels ? (
        <article className="min-w-0 rounded-xl border border-line bg-white p-4 sm:p-5">
          <h2 className="text-lg font-bold text-ink">Élèves par niveau</h2>
          <p className="mt-1 text-xs text-muted">Effectifs de l'établissement selon les niveaux renseignés.</p>
          {levels.length ? (
            <>
              <div className="mt-3 h-64 min-w-0" role="img" aria-label="Répartition des élèves par niveau">
                <DonutChart data={levels.map((item, index) => ({
                  ...item,
                  fill: CHART_PALETTE[index % CHART_PALETTE.length],
                }))} />
              </div>
              <ul className="mt-2 space-y-2 text-sm" aria-label="Effectifs par niveau">
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
        <article className="min-w-0 rounded-xl border border-line bg-white p-4 sm:p-5">
          <h2 className="text-lg font-bold text-ink">Présence du jour</h2>
          <p className="mt-1 text-xs text-muted">Présents et retards comptés comme ayant assisté. Les absences justifiées restent des absences.</p>
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <p className="text-5xl font-black tabular-nums text-ink">{attendance.value}</p>
            <p className="text-sm text-muted">
              {attendance.recorded.toLocaleString("fr-FR")} appels enregistrés sur {attendance.expected.toLocaleString("fr-FR")} élèves attendus
            </p>
            {attendance.rate !== null ? (
              <div className="w-full max-w-sm">
                <div role="progressbar" aria-label="Taux de présence du jour" aria-valuemin={0} aria-valuemax={100} aria-valuenow={attendance.rate} className="h-3 overflow-hidden rounded-full bg-slate-100">
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
