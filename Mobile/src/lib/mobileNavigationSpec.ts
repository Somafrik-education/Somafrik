/**
 * Contrat UI/UX — navigation principale mobile (bottom tabs).
 */

export const NAVIGATION_COPY = {
  tabAccueil: "Accueil",
  tabClasses: "Classes",
  tabTeachers: "Enseignants",
  tabMenu: "Menu",
  homeOverview: "Vue d'ensemble",
  teachersTitle: "Enseignants",
  menuTitle: "Menu",
} as const;

export const NAVIGATION_TEST_IDS = {
  tabBar: "mobile-tab-bar",
  homeAdminDashboard: "home-admin-dashboard",
  homeOverviewTitle: "home-overview-title",
  teachersScreen: "teachers-screen",
  teachersTitle: "teachers-title",
  menuScreen: "menu-screen",
  menuTitle: "menu-title",
  activeTabIndicator: "tab-active-indicator",
} as const;

/** Temps max acceptable pour afficher un écran après changement d'onglet. */
export const TAB_TRANSITION_MAX_MS = 2000;

export function tabTestIdForTabName(tabName: string): string | undefined {
  switch (tabName) {
    case "Accueil":
      return "tab-accueil";
    case "Classes":
      return "tab-classes";
    case "Enseignants":
      return "tab-enseignants";
    case "Menu":
      return "tab-menu";
    default:
      return undefined;
  }
}
