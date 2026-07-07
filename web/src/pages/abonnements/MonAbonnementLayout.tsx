import { Outlet } from "react-router-dom";
import { CreditCard, FileText, RefreshCw, Wallet, XCircle } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";

const MY_SUBSCRIPTION_TABS: TabItem[] = [
  { to: "/parametres/mon-abonnement", label: "Mon abonnement", icon: Wallet, end: true },
  { to: "/parametres/mon-abonnement/factures", label: "Factures & reçus", icon: FileText },
  { to: "/parametres/mon-abonnement/paiements", label: "Paiements", icon: CreditCard },
  { to: "/parametres/mon-abonnement/changer-offre", label: "Changer d'offre", icon: RefreshCw },
  { to: "/parametres/mon-abonnement/resiliation", label: "Résiliation", icon: XCircle },
];

/** Espace établissement : consultation et gestion de l'abonnement SaaS. */
export function MonAbonnementLayout() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Paramètres établissement</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Mon abonnement</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Consultez votre offre, vos factures et vos paiements. Demandez un changement d'offre ou une résiliation.
        </p>
      </div>
      <TabNav tabs={MY_SUBSCRIPTION_TABS} variant="sub" />
      <Outlet />
    </div>
  );
}
