import { Outlet } from "react-router-dom";
import { AlertTriangle, CreditCard, Receipt } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";

const FINANCE_TABS: TabItem[] = [
  { to: "/finances/paiements", label: "Paiements", icon: CreditCard },
  { to: "/finances/frais", label: "Frais & tarifs", icon: Receipt },
  { to: "/finances/impayes", label: "Impayés", icon: AlertTriangle },
];

/** Module Finances : en-tête + onglets, contenu via <Outlet />. */
export function FinancesLayout() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Gestion financière</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Finances</h1>
        <p className="mt-1 text-sm text-muted">
          Tarif → obligation élève → encaissement → affectation → solde.
        </p>
      </div>
      <TabNav tabs={FINANCE_TABS} />
      <Outlet />
    </div>
  );
}
