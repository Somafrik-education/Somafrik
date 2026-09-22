import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { NAV_ITEMS, PARENT_NAV_ITEMS } from "../../lib/constants";
import { CONFIGURATION_USER_ACCOUNTS, SCHOOL_ENTITY_MODULES } from "../../lib/entityModules";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { SubscriptionAccessBanner } from "../SubscriptionAccessBanner";
import { DomainRouteBootstrap } from "../DomainRouteBootstrap";
import { DemoRuntimeChrome } from "../demo/DemoRuntimeChrome";
import { useAuth } from "../../context/AuthContext";
import { isParentRole } from "../../lib/format";

const HelpHost = lazy(() =>
  import("../../help/HelpHost").then((module) => ({ default: module.HelpHost })),
);

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
  { path: "/etablissement/vue-ensemble", label: "Scolarité" },
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
  { view: "notifications", path: "/notifications-plateforme", label: "Notifications plateforme" },
  { view: "notifications", path: "/notifications", label: "Notifications" },
];

export function resolveAppNavigationTitle(pathname: string, parentRole: boolean) {
  if (pathname === "/notifications" || pathname === "/notifications-plateforme") {
    return "Notifications";
  }
  if (!parentRole && (pathname === "/messages" || pathname === "/annonces")) {
    return "Communication";
  }
  const source = parentRole ? PARENT_NAV_ITEMS : PAGE_NAV_ITEMS;
  const match = source
    .filter(
      (item) =>
        item.path === pathname ||
        (item.path !== "/tableau-de-bord" && pathname.startsWith(item.path)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.label ?? (parentRole ? "Accueil" : "Tableau de bord");
}

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const { session } = useAuth();
  const parentRole = isParentRole(session?.user?.role);
  const title = useMemo(
    () => resolveAppNavigationTitle(location.pathname, parentRole),
    [location.pathname, parentRole],
  );

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen">
      <DomainRouteBootstrap />
      <Sidebar />
      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenuOpen={() => setMobileNavOpen(true)} />
        <DemoRuntimeChrome />
        <main className="flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            <SubscriptionAccessBanner />
            <Outlet />
          </div>
        </main>
      </div>
      <Suspense fallback={null}>
        <HelpHost />
      </Suspense>
    </div>
  );
}
