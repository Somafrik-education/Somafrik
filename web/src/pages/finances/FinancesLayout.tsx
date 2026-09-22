import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, CreditCard, Receipt } from "lucide-react";
import { LoadingState, ErrorState } from "@/design-system";
import { TabNav, type TabItem } from "../../components/layout/TabNav";
import { useAuth } from "../../context/AuthContext";
import { buildDomainRouteHydrationKey, useDomainRouteHydrationStatus } from "../../lib/domainRouteHydration";
import { demoRuntimeEnabled } from "../../lib/featureFlags";
import { firstAllowedFinanceLeaf } from "../../lib/financeRouteAccess";
import { canReadView } from "../../lib/permissions";
import { getDefaultAppPath } from "../../lib/superAdminAccess";
import { parentFinanceShellDecision } from "../../lib/parentFinanceRoute";
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
  const { session } = useAuth();
  const tabs = FINANCE_TABS.filter((tab) => canReadView(ctx, tab.view));
  const location = useLocation();

  // Hook toujours appelé avant toute bifurcation de rendu pour respecter
  // l'ordre React ; le résultat n'est utilisé que par le shell staff.
  const schoolCode = String(ctx.user?.schoolCode ?? "").trim();
  const hydrationKey = buildDomainRouteHydrationKey(location.key, location.pathname, schoolCode);
  const hydrationStatus = useDomainRouteHydrationStatus(hydrationKey);

  const parentDecision = parentFinanceShellDecision(
    session?.user?.role,
    location.pathname,
    canReadView(ctx, "payments"),
  );

  if (parentDecision === "dashboard") {
    return <Navigate to={getDefaultAppPath(session?.user?.role)} replace />;
  }
  if (parentDecision === "payments") {
    return <Navigate to="/finances/paiements" replace />;
  }
  if (parentDecision === "content") {
    return <Outlet />;
  }

  const demoWaiting = demoRuntimeEnabled && (hydrationStatus === "idle" || hydrationStatus === "loading");
  const demoFailed = demoRuntimeEnabled && hydrationStatus === "error";

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
      {demoWaiting ? (
        <LoadingState message="Chargement des paiements et obligations de démonstration…" />
      ) : demoFailed ? (
        <ErrorState
          title="Impossible de charger les données financières."
          message="Les données de démonstration n'ont pas pu être hydratées complètement."
        />
      ) : (
        <Outlet />
      )}
    </div>
  );
}
