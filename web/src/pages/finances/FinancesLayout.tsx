import { Navigate, Outlet } from "react-router-dom";
import { AlertTriangle, CreditCard, Receipt } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";
import { useAuth } from "../../context/AuthContext";
import { firstAllowedFinanceLeaf } from "../../lib/financeRouteAccess";
import { canReadView } from "../../lib/permissions";
import { getDefaultAppPath } from "../../lib/superAdminAccess";
import { usePermissionContext } from "../../lib/usePermissionContext";

const FINANCE_TABS: (TabItem & { view: string })[] = [
  { to: "/finances/paiements", label: "Paiements", icon: CreditCard, view: "payments" },
  { to: "/finances/frais", label: "Frais & tarifs", icon: Receipt, view: "fees" },
  { to: "/finances/impayes", label: "Impayés", icon: AlertTriangle, view: "unpaid" },
];

/** `/finances` → première feuille autorisée (Paiements, sinon Frais, sinon Impayés). */
export function FinanceIndexRedirect() {
  const ctx = usePermissionContext();
  const { session } = useAuth();
  const leaf = firstAllowedFinanceLeaf(ctx);
  if (!leaf) {
    return <Navigate to={getDefaultAppPath(session?.user?.role)} replace />;
  }
  return <Navigate to={leaf} replace />;
}

/** Module Finances : en-tête + onglets, contenu via <Outlet />. */
export function FinancesLayout() {
  const ctx = usePermissionContext();
  const tabs = FINANCE_TABS.filter((tab) => canReadView(ctx, tab.view));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Gestion financière</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Finances</h1>
        <p className="mt-1 text-sm text-muted">
          Tarif → obligation élève → encaissement → affectation → solde.
        </p>
      </div>
      <TabNav tabs={tabs} />
      <Outlet />
    </div>
  );
}
