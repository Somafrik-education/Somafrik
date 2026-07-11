import { Outlet } from "react-router-dom";
import { AlertTriangle, CalendarClock, DoorOpen, Repeat } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";

const PLANNING_TABS: TabItem[] = [
  { to: "/planning/emploi-du-temps", label: "Emploi du temps", icon: CalendarClock },
  { to: "/planning/salles", label: "Salles", icon: DoorOpen },
  { to: "/planning/remplacements", label: "Remplacements", icon: Repeat },
  { to: "/planning/conflits", label: "Conflits", icon: AlertTriangle },
];

/** Module Planning : en-tête + onglets horizontaux, contenu via <Outlet />. */
export function PlanningLayout() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Pédagogie</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Planning</h1>
        <p className="mt-1 text-sm text-muted">
          Emploi du temps, salles, remplacements et conflits d'un même endroit. La relation
          enseignant ↔ classe ↔ matière se gère dans Mon établissement → Enseignants.
        </p>
      </div>
      <TabNav tabs={PLANNING_TABS} />
      <Outlet />
    </div>
  );
}
