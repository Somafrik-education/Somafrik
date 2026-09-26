import type { ReactNode } from "react";
import { todayPeriodDate } from "../../lib/dates";
import { SchoolRecentActivities } from "./SchoolRecentActivities";
import { SchoolDashboardSecondaryWidgets } from "./SchoolDashboardSecondaryWidgets";
import type { TodayPresenceKpi } from "../../lib/presenceMetrics";

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
  activitiesEnabled: boolean;
  schoolKey: string;
  levels: Array<{ name: string; value: number }>;
  attendance: TodayPresenceKpi;
  canReadPresences: boolean;
};

/** Establishment dashboard: central chart and compact secondary cards share the main column. */
export function EstablishmentDashboardLayout({ students, teachers, classes, revenue, canReadStudents, canReadTeachers, canReadClasses, canReadPayments, activitiesEnabled, schoolKey, levels, attendance, canReadPresences, children }: Props) {
  const consultationDate = todayPeriodDate();

  const metrics: Metric[] = [
    ...(canReadStudents ? [{ label: "Élèves", value: students.toLocaleString("fr-FR"), icon: "👥", tone: "bg-blue-50 border-blue-100" }] : []),
    ...(canReadTeachers ? [{ label: "Enseignants", value: teachers.toLocaleString("fr-FR"), icon: "▣", tone: "bg-emerald-50 border-emerald-100" }] : []),
    ...(canReadClasses ? [{ label: "Classes", value: classes.toLocaleString("fr-FR"), icon: "▤", tone: "bg-violet-50 border-violet-100" }] : []),
    ...(canReadPayments ? [{ label: "Recettes", value: revenue, icon: "◉", tone: "bg-orange-50 border-orange-100" }] : []),
  ];
  return (
    <section className="space-y-3" aria-label="Tableau de bord établissement">
      <div className="grid min-w-0 items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        <div className="min-w-0 space-y-3">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-ink">Tableau de bord</h1>
              <p className="text-sm text-muted">Vue d'ensemble de votre établissement</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Année scolaire
                <span className="rounded-lg border border-line bg-slate-50 px-2 py-1 text-xs text-ink">Non sélectionnée</span>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Date de consultation
                <span className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-ink">{consultationDate}</span>
              </label>
            </div>
          </header>
          <p className="text-xs text-muted">Les indicateurs reflètent les données actuelles. Les filtres historiques seront activés après validation de leur contrat métier.</p>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            {metrics.map((metric) => (
              <article key={metric.label} className={`rounded-xl border px-3 py-2 ${metric.tone}`}>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="rounded-lg bg-white/80 p-2 text-base">{metric.icon}</span>
                  <div className="min-w-0">
                    <h2 className="text-xs font-semibold text-ink">{metric.label}</h2>
                    <p className="break-words text-xl font-bold text-ink">{metric.value}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="min-w-0 space-y-2">
            {children}
            <SchoolDashboardSecondaryWidgets levels={levels} attendance={attendance} showLevels={canReadStudents} showAttendance={canReadPresences} />
          </div>
        </div>
        <aside aria-label="Activités récentes" className="min-w-0 self-stretch rounded-xl border border-line bg-white p-3 shadow-sm">
          <h2 className="text-sm font-bold text-ink">Activités récentes</h2>
          <SchoolRecentActivities enabled={activitiesEnabled} schoolKey={schoolKey} />
        </aside>
      </div>
    </section>
  );
}
