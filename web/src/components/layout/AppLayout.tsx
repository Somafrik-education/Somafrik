import { useMemo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { NAV_ITEMS } from "../../lib/constants";
import { CONFIGURATION_USER_ACCOUNTS, SCHOOL_ENTITY_MODULES } from "../../lib/entityModules";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SubscriptionAccessBanner } from "../SubscriptionAccessBanner";

const SUBSCRIPTION_NAV = [
  { path: "/abonnements/offres", label: "Abonnements" },
  { path: "/abonnements/etablissements", label: "Abonnements" },
  { path: "/abonnements/paiements", label: "Abonnements" },
  { path: "/abonnements/factures", label: "Abonnements" },
  { path: "/abonnements/remises", label: "Abonnements" },
  { path: "/abonnements/retards", label: "Abonnements" },
  { path: "/abonnements/rapports", label: "Abonnements" },
  { path: "/abonnements/tarifs-pays", label: "Abonnements" },
  { path: "/parametres/mon-abonnement", label: "Mon abonnement" },
];

const ETABLISSEMENT_PAGE_NAV = [
  { path: "/etablissement/vue-ensemble", label: "Vue d'ensemble" },
  { path: "/etablissement/comptes-utilisateurs", label: "Comptes utilisateurs" },
  { path: "/etablissement/relations-parent-enfant", label: "Parents & élèves" },
];

const PAGE_NAV_ITEMS = [
  ...NAV_ITEMS,
  ...SUBSCRIPTION_NAV,
  ...ETABLISSEMENT_PAGE_NAV,
  ...SCHOOL_ENTITY_MODULES.filter((module) => module.key !== "contacts").map((module) => ({
    view: module.view,
    path: module.path,
    label: module.label,
  })),
  {
    view: CONFIGURATION_USER_ACCOUNTS.view,
    path: CONFIGURATION_USER_ACCOUNTS.path,
    label: CONFIGURATION_USER_ACCOUNTS.label,
  },
  // Notifications retirées du menu latéral (accès via la cloche du Topbar) mais gardent leur titre de page.
  { view: "notifications", path: "/notifications", label: "Notifications" },
];

export function AppLayout() {
  const location = useLocation();
  const title = useMemo(() => {
    const match = PAGE_NAV_ITEMS.filter(
      (item) =>
        item.path === location.pathname ||
        (item.path !== "/tableau-de-bord" && location.pathname.startsWith(item.path)),
    ).sort((a, b) => b.path.length - a.path.length)[0];
    return match?.label ?? "Tableau de bord";
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} />
        <main className="flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            <SubscriptionAccessBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
