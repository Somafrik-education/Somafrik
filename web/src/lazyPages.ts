import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** Charge une page exportée en nommé comme composant React lazy. */
function lazyPage(
  loader: () => Promise<Record<string, ComponentType<any>>>,
  exportName: string,
): LazyExoticComponent<ComponentType<any>> {
  return lazy(() =>
    loader().then((module) => ({
      default: module[exportName],
    })),
  );
}

export const LandingPage = lazyPage(() => import("./pages/LandingPage"), "LandingPage");
export const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage");
export const DashboardEntryPage = lazyPage(() => import("./pages/DashboardEntryPage"), "DashboardEntryPage");
/** Alias explicite (ex. lazy routes type DashboardPage). */
export const DashboardPage = DashboardEntryPage;
export const MarketplacePage = lazyPage(() => import("./pages/MarketplacePage"), "MarketplacePage");
export const CountriesPage = lazyPage(() => import("./pages/CountriesPage"), "CountriesPage");
export const EducationReferencePage = lazyPage(
  () => import("./pages/EducationReferencePage"),
  "EducationReferencePage",
);
export const SchoolsPage = lazyPage(() => import("./pages/SchoolsPage"), "SchoolsPage");
export const SubscriptionsLayout = lazyPage(
  () => import("./pages/abonnements/SubscriptionsLayout"),
  "SubscriptionsLayout",
);
export const SubscriptionOffersPage = lazyPage(
  () => import("./pages/abonnements/SubscriptionOffersPage"),
  "SubscriptionOffersPage",
);
export const SubscriptionSchoolsPage = lazyPage(
  () => import("./pages/abonnements/SubscriptionSchoolsPage"),
  "SubscriptionSchoolsPage",
);
export const SubscriptionPaymentsPage = lazyPage(
  () => import("./pages/abonnements/SubscriptionPaymentsPage"),
  "SubscriptionPaymentsPage",
);
export const SubscriptionInvoicesPage = lazyPage(
  () => import("./pages/abonnements/SubscriptionInvoicesPage"),
  "SubscriptionInvoicesPage",
);
export const SubscriptionDiscountsPage = lazyPage(
  () => import("./pages/abonnements/SubscriptionDiscountsPage"),
  "SubscriptionDiscountsPage",
);
export const SubscriptionDelinquencyPage = lazyPage(
  () => import("./pages/abonnements/SubscriptionDelinquencyPage"),
  "SubscriptionDelinquencyPage",
);
export const SubscriptionReportsPage = lazyPage(
  () => import("./pages/abonnements/SubscriptionReportsPage"),
  "SubscriptionReportsPage",
);
export const MonAbonnementLayout = lazyPage(
  () => import("./pages/abonnements/MonAbonnementLayout"),
  "MonAbonnementLayout",
);
export const MonAbonnementPage = lazyPage(
  () => import("./pages/abonnements/MonAbonnementPage"),
  "MonAbonnementPage",
);
export const MonAbonnementInvoicesPage = lazyPage(
  () => import("./pages/abonnements/MonAbonnementInvoicesPage"),
  "MonAbonnementInvoicesPage",
);
export const MonAbonnementPaymentsPage = lazyPage(
  () => import("./pages/abonnements/MonAbonnementPaymentsPage"),
  "MonAbonnementPaymentsPage",
);
export const ChangeOfferPage = lazyPage(() => import("./pages/abonnements/ChangeOfferPage"), "ChangeOfferPage");
export const CancellationRequestPage = lazyPage(
  () => import("./pages/abonnements/CancellationRequestPage"),
  "CancellationRequestPage",
);
export const NotificationsPage = lazyPage(() => import("./pages/NotificationsPage"), "NotificationsPage");
export const UsersPage = lazyPage(() => import("./pages/UsersPage"), "UsersPage");
export const PermissionsPage = lazyPage(() => import("./pages/PermissionsPage"), "PermissionsPage");
export const ChartSettingsPage = lazyPage(() => import("./pages/ChartSettingsPage"), "ChartSettingsPage");
export const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage");
export const ConfigurationPage = lazyPage(() => import("./pages/ConfigurationPage"), "ConfigurationPage");
export const EntityPage = lazyPage(() => import("./pages/EntityPage"), "EntityPage");
export const CoursePlanningPage = lazyPage(() => import("./pages/CoursePlanningPage"), "CoursePlanningPage");
export const PlanningLayout = lazyPage(() => import("./pages/planning/PlanningLayout"), "PlanningLayout");
export const TimetableLayout = lazyPage(() => import("./pages/planning/TimetableLayout"), "TimetableLayout");
export const TimetableByClassPage = lazyPage(
  () => import("./pages/planning/TimetableByClassPage"),
  "TimetableByClassPage",
);
export const TimetableByTeacherPage = lazyPage(
  () => import("./pages/planning/TimetableByTeacherPage"),
  "TimetableByTeacherPage",
);
export const PlanningRoomsPage = lazyPage(
  () => import("./pages/planning/PlanningRoomsPage"),
  "PlanningRoomsPage",
);
export const PlanningSubstitutionsPage = lazyPage(
  () => import("./pages/planning/PlanningSubstitutionsPage"),
  "PlanningSubstitutionsPage",
);
export const TimetableByRoomPage = lazyPage(
  () => import("./pages/planning/PlanningPlaceholders"),
  "TimetableByRoomPage",
);
export const PlanningConflictsPage = lazyPage(
  () => import("./pages/planning/PlanningConflictsPage"),
  "PlanningConflictsPage",
);
export const FinancesLayout = lazyPage(() => import("./pages/finances/FinancesLayout"), "FinancesLayout");
export const FinanceFeesPage = lazyPage(() => import("./pages/finances/FinanceFeesPage"), "FinanceFeesPage");
export const FinanceUnpaidPage = lazyPage(() => import("./pages/finances/FinanceUnpaidPage"), "FinanceUnpaidPage");
export const MonEtablissementLayout = lazyPage(
  () => import("./pages/etablissement/MonEtablissementLayout"),
  "MonEtablissementLayout",
);
export const EtablissementOverviewPage = lazyPage(
  () => import("./pages/etablissement/EtablissementOverviewPage"),
  "EtablissementOverviewPage",
);
export const ClassesListPage = lazyPage(
  () => import("./pages/etablissement/ClassesListPage"),
  "ClassesListPage",
);
export const TeachersListPage = lazyPage(
  () => import("./pages/etablissement/TeachersListPage"),
  "TeachersListPage",
);
export const StudentsListPage = lazyPage(
  () => import("./pages/etablissement/StudentsListPage"),
  "StudentsListPage",
);
export const ClassStudentsPage = lazyPage(
  () => import("./pages/etablissement/ClassStudentsPage"),
  "ClassStudentsPage",
);
export const ParentChildRelationsPage = lazyPage(
  () => import("./pages/etablissement/ParentChildRelationsPage"),
  "ParentChildRelationsPage",
);
export const StudentWorkspacePage = lazyPage(
  () => import("./pages/etablissement/StudentWorkspacePage"),
  "StudentWorkspacePage",
);
export const AdministrationLayout = lazyPage(
  () => import("./pages/administration/AdministrationLayout"),
  "AdministrationLayout",
);
export const ParametresLayout = lazyPage(() => import("./pages/parametres/ParametresLayout"), "ParametresLayout");
export const SettingsHubPage = lazyPage(() => import("./pages/parametres/SettingsHubPage"), "SettingsHubPage");
export const SubscriptionPolicySettingsPage = lazyPage(
  () => import("./pages/parametres/SubscriptionPolicySettingsPage"),
  "SubscriptionPolicySettingsPage",
);
export const SettingsAppearancePage = lazyPage(
  () => import("./pages/parametres/SettingsPlaceholders"),
  "SettingsAppearancePage",
);
export const SettingsDataPage = lazyPage(
  () => import("./pages/parametres/SettingsPlaceholders"),
  "SettingsDataPage",
);
export const SettingsFinancePage = lazyPage(
  () => import("./pages/parametres/SettingsPlaceholders"),
  "SettingsFinancePage",
);
export const SettingsIntegrationsPage = lazyPage(
  () => import("./pages/parametres/SettingsPlaceholders"),
  "SettingsIntegrationsPage",
);
export const SettingsNotificationsPage = lazyPage(
  () => import("./pages/parametres/SettingsPlaceholders"),
  "SettingsNotificationsPage",
);
export const SettingsProfilePage = lazyPage(
  () => import("./pages/parametres/SettingsPlaceholders"),
  "SettingsProfilePage",
);
export const SettingsSecurityPage = lazyPage(
  () => import("./pages/parametres/SettingsPlaceholders"),
  "SettingsSecurityPage",
);
export const BulletinDesignPage = lazyPage(() => import("./pages/BulletinDesignPage"), "BulletinDesignPage");
export const PresencesPage = lazyPage(() => import("./pages/PresencesPage"), "PresencesPage");
export const GradesEvaluationsPage = lazyPage(
  () => import("./pages/GradesEvaluationsPage"),
  "GradesEvaluationsPage",
);
