import { Outlet } from "react-router-dom";
import { ClipboardCheck, FileText, Link2, ShieldCheck, Users } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";

const ADMINISTRATION_TABS: (TabItem & { view: string })[] = [
  { to: "/administration/relations", label: "Relations", icon: Link2, view: "relations" },
  { to: "/administration/utilisateurs", label: "Utilisateurs", icon: Users, view: "users" },
  { to: "/administration/permissions", label: "Rôles et droits", icon: ShieldCheck, view: "permissions" },
  { to: "/administration/documents", label: "Documents", icon: FileText, view: "documents" },
  { to: "/administration/conformite", label: "Conformité", icon: ClipboardCheck, view: "reports" },
];

/** Module Administration : en-tête + onglets, contenu via <Outlet />. */
export function AdministrationLayout() {
  const ctx = usePermissionContext();
  // ADMIN-03B : masquer uniquement Relations. Documents / Conformité / Users / Permissions restent visibles.
  const tabs = ADMINISTRATION_TABS.filter(
    (tab) => tab.to !== "/administration/relations" || canReadView(ctx, "relations"),
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Gouvernance</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Administration</h1>
        <p className="mt-1 text-sm text-muted">
          Comptes et rôles, documents administratifs et conformité de la plateforme.
        </p>
      </div>
      <TabNav tabs={tabs} />
      <Outlet />
    </div>
  );
}
