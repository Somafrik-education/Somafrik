import { Outlet } from "react-router-dom";
import { ClipboardCheck, FileText, Link2, ShieldCheck, Users } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";

const ADMINISTRATION_TABS: TabItem[] = [
  { to: "/administration/relations", label: "Relations", icon: Link2 },
  { to: "/administration/utilisateurs", label: "Utilisateurs", icon: Users },
  { to: "/administration/permissions", label: "Rôles et droits", icon: ShieldCheck },
  { to: "/administration/documents", label: "Documents", icon: FileText },
  { to: "/administration/conformite", label: "Conformité", icon: ClipboardCheck },
];

/** Module Administration : en-tête + onglets, contenu via <Outlet />. */
export function AdministrationLayout() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Gouvernance</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Administration</h1>
        <p className="mt-1 text-sm text-muted">
          Comptes et rôles, documents administratifs et conformité de la plateforme.
        </p>
      </div>
      <TabNav tabs={ADMINISTRATION_TABS} />
      <Outlet />
    </div>
  );
}
