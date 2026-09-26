import type { ReactNode } from "react";

type Metric = { label: string; value: string; icon: string; tone: string };
type Props = {
  students: number;
  teachers: number;
  classes: number;
  revenue: string;
  canReadStudents: boolean;
  canReadTeachers: boolean;
  canReadClasses: boolean;
  canReadPayments: boolean;
  children: ReactNode;
};

/** LOT 1: layout only. Historical filters and new widgets arrive in later lots. */
export function EstablishmentDashboardLayout({ students, teachers, classes, revenue, canReadStudents, canReadTeachers, canReadClasses, canReadPayments, children }: Props) {
  const consultationDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());

  const metrics: Metric[] = [
    ...(canReadStudents ? [{ label: "Élèves", value: students.toLocaleString("fr-FR"), icon: "👥", tone: "bg-blue-50 border-blue-100" }] : []),
    ...(canReadTeachers ? [{ label: "Enseignants", value: teachers.toLocaleString("fr-FR"), icon: "▣", tone: "bg-emerald-50 border-emerald-100" }] : []),
    ...(canReadClasses ? [{ label: "Classes", value: classes.toLocaleString("fr-FR"), icon: "▤", tone: "bg-violet-50 border-violet-100" }] : []),
    ...(canReadPayments ? [{ label: "Recettes", value: revenue, icon: "◉", tone: "bg-orange-50 border-orange-100" }] : []),
  ];
  return (
    <section className="space-y-5" aria-label="Tableau de bord établissement">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Tableau de bord</h1>
          <p className="text-sm text-muted">Vue d'ensemble de votre établissement</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Année scolaire
            <span className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-ink">Non sélectionnée</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Date de consultation
            <span className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-ink">{consultationDate}</span>
          </label>
        </div>
      </header>
      <p className="text-xs text-muted">Les indicateurs reflètent les données actuelles. Les filtres historiques seront activés après validation de leur contrat métier.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.label} className={`rounded-xl border p-4 ${metric.tone}`}>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="rounded-lg bg-white/80 p-3 text-xl">{metric.icon}</span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-ink">{metric.label}</h2>
                <p className="break-words text-2xl font-bold text-ink">{metric.value}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="min-w-0">{children}</div>
        <aside aria-label="Activités récentes" className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-lg font-bold text-ink">Activités récentes</h2>
          <p className="mt-4 text-sm text-muted">Le fil d'activités sera disponible après le LOT 3.</p>
        </aside>
      </div>
    </section>
  );
}
