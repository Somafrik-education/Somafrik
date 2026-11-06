import { Navigate, Outlet } from "react-router-dom";
import { AlertTriangle, CalendarClock, ClipboardList, DoorOpen, Repeat } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { canReadView } from "../../lib/permissions";

const PLANNING_TABS: TabItem[] = [
  { to: "/planning/emploi-du-temps", label: "Emploi du temps", icon: CalendarClock },
  { to: "/planning/salles", label: "Salles", icon: DoorOpen },
  { to: "/planning/remplacements", label: "Remplacements", icon: Repeat },
  { to: "/planning/conflits", label: "Conflits", icon: AlertTriangle },
  { to: "/planning/examens", label: "Examens", icon: ClipboardList },
];

/** Un utilisateur Examens-only ne doit ni perdre son accès, ni obtenir le droit Planning. */
export function PlanningIndexRedirect() {
  const ctx = usePermissionContext();
  return <Navigate to={canReadView(ctx, "planning") ? "emploi-du-temps" : "examens"} replace />;
}

export function PlanningLayout() {
  const ctx = usePermissionContext();
  const canPlan = canReadView(ctx, "planning");
  const canExams = canReadView(ctx, "exams");
  const tabs = PLANNING_TABS.filter((item) =>
    item.to === "/planning/examens" ? canExams : canPlan,
  );
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Pédagogie</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Planning</h1>
        <p className="mt-1 text-sm text-muted">
          Emploi du temps, examens, salles et remplacements. Les droits Planning et Examens
          restent indépendants ; les résultats sont toujours protégés par leur permission.
        </p>
      </div>
      <TabNav tabs={tabs} />
      <Outlet />
    </div>
  );
}
