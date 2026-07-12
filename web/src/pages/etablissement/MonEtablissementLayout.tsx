import { Outlet } from "react-router-dom";
import { GraduationCap, LayoutDashboard, Link2, School, UserRound, Users } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";

/**
 * Onglets Mon établissement — gestion opérationnelle des personnes et structures.
 */
const ETABLISSEMENT_TABS: (TabItem & { view: string })[] = [
  { to: "/etablissement/vue-ensemble", label: "Vue d'ensemble", icon: LayoutDashboard, view: "establishment" },
  { to: "/etablissement/comptes-utilisateurs", label: "Comptes utilisateurs", icon: UserRound, view: "users" },
  { to: "/etablissement/classes", label: "Classes", icon: School, view: "classes" },
  { to: "/etablissement/eleves", label: "Élèves", icon: GraduationCap, view: "students" },
  { to: "/etablissement/enseignants", label: "Enseignants", icon: Users, view: "teachers" },
  { to: "/etablissement/relations-parent-enfant", label: "Parents & élèves", icon: Link2, view: "relations" },
];

/** Module Mon établissement : en-tête + onglets, contenu via <Outlet />. */
export function MonEtablissementLayout() {
  const ctx = usePermissionContext();
  const tabs = ETABLISSEMENT_TABS.filter((tab) => canReadView(ctx, tab.view));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Mon établissement</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Mon établissement</h1>
        <p className="mt-1 text-sm text-muted">
          Comptes d'accès, classes, effectifs et liaisons parent-enfant de l'établissement.
        </p>
      </div>
      <TabNav tabs={tabs} />
      <Outlet />
    </div>
  );
}
