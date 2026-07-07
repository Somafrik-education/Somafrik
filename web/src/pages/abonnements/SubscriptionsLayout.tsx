import { Outlet } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CreditCard,
  FileText,
  Package,
  Percent,
  Receipt,
} from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";

const SUBSCRIPTION_TABS: TabItem[] = [
  { to: "/abonnements/offres", label: "Offres", icon: Package },
  { to: "/abonnements/etablissements", label: "Abonnements", icon: Building2 },
  { to: "/abonnements/paiements", label: "Paiements", icon: CreditCard },
  { to: "/abonnements/factures", label: "Factures", icon: Receipt },
  { to: "/abonnements/remises", label: "Remises", icon: Percent },
  { to: "/abonnements/retards", label: "Retards & suspensions", icon: AlertTriangle },
  { to: "/abonnements/rapports", label: "Rapports", icon: BarChart3 },
  { to: "/abonnements/tarifs-pays", label: "Tarifs pays", icon: FileText },
];

/** Module Abonnements SaaS : offres, abonnements établissements, paiements et politiques. */
export function SubscriptionsLayout() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Administration Somafrik</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Abonnements</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Offres commerciales, abonnements par établissement, facturation, retards et rapports.
          L'abonnement est rattaché à l'établissement, pas à un utilisateur individuel.
        </p>
      </div>
      <TabNav tabs={SUBSCRIPTION_TABS} />
      <Outlet />
    </div>
  );
}
