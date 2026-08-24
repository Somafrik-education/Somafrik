/**
 * Contrat UI/UX — navigation principale mobile (bottom tabs).
 * V1.2 : plus d’onglet Menu. Les modules secondaires sont dans le drawer.
 */

export const NAVIGATION_COPY = {
  tabAccueil: "Accueil",
  tabClasses: "Classes",
  tabStudents: "Élèves",
  tabAttendance: "Présence",
  tabPayments: "Paiement",
  tabTeachers: "Profs",
  tabFrais: "Paiement",
  tabComptes: "Comptes",
  homeOverview: "Vue d'ensemble",
  teachersTitle: "Enseignants",
} as const;

export const NAVIGATION_TEST_IDS = {
  tabBar: "mobile-tab-bar",
  homeAdminDashboard: "home-admin-dashboard",
  homeOverviewTitle: "home-overview-title",
  teachersScreen: "teachers-screen",
  teachersTitle: "teachers-title",
  headerMenu: "mobile-header-menu",
  roleDrawer: "mobile-role-drawer",
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
    case "Profs":
      return "tab-enseignants";
    case "TeacherStudents":
    case "Students":
    case "Élèves":
      return "tab-eleves";
    case "TeacherAttendance":
    case "Présence":
    case "Présences":
      return "tab-presences";
    case "Paiements":
    case "Paiement":
    case "Frais":
      return "tab-frais";
    case "Utilisateurs":
    case "Comptes":
      return "tab-comptes";
    case "Schools":
    case "Écoles":
      return "tab-ecoles";
    case "Subscriptions":
    case "Offres":
      return "tab-offres";
    case "PlatformNotifications":
    case "Notifs":
      return "tab-notifs";
    default:
      return undefined;
  }
}
