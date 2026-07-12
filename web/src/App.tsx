import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PermissionRoute } from "./components/PermissionRoute";
import { RouteFallback } from "./components/RouteFallback";
import { AppLayout } from "./components/layout/AppLayout";
import { DataProvider } from "./context/DataContext";
import { isMarketplaceEnabled } from "./lib/marketplaceFeature";import {
  AdministrationLayout,
  BulletinDesignPage,
  CancellationRequestPage,
  ChangeOfferPage,
  ChartSettingsPage,
  ClassStudentsPage,
  ConfigurationPage,
  CountriesPage,
  CoursePlanningPage,
  DashboardEntryPage,
  MarketplacePage,
  EtablissementOverviewPage,  EntityPage,
  FinanceFeesPage,
  FinanceUnpaidPage,
  FinancesLayout,
  GradesEvaluationsPage,
  LandingPage,
  LoginPage,
  MonAbonnementInvoicesPage,
  MonAbonnementLayout,
  MonAbonnementPage,
  MonAbonnementPaymentsPage,
  MonEtablissementLayout,
  NotificationsPage,
  ParametresLayout,
  ParentChildRelationsPage,
  PermissionsPage,
  PlanningConflictsPage,
  PlanningLayout,
  PlanningRoomsPage,
  PlanningSubstitutionsPage,
  PresencesPage,
  ReportsPage,
  SchoolsPage,
  SettingsAppearancePage,
  SettingsDataPage,
  SettingsFinancePage,
  SettingsHubPage,
  SettingsIntegrationsPage,
  SettingsNotificationsPage,
  SettingsProfilePage,
  SettingsSecurityPage,
  SubscriptionDelinquencyPage,
  SubscriptionDiscountsPage,
  SubscriptionInvoicesPage,
  SubscriptionOffersPage,
  SubscriptionPaymentsPage,
  SubscriptionPolicySettingsPage,
  SubscriptionReportsPage,
  SubscriptionSchoolsPage,
  SubscriptionsLayout,
  TimetableByClassPage,
  TimetableByRoomPage,
  TimetableByTeacherPage,
  TimetableLayout,
  UsersPage,
} from "./lazyPages";
import { ActiveSchoolProvider } from "./context/ActiveSchoolContext";

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/connexion" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <DataProvider>
              <ActiveSchoolProvider>
                <AppLayout />
              </ActiveSchoolProvider>
            </DataProvider>
          </ProtectedRoute>
        }
      >
        <Route
          path="/tableau-de-bord"
          element={
            <PermissionRoute view="overview">
              <DashboardEntryPage />
            </PermissionRoute>
          }
        />
        {isMarketplaceEnabled() ? (
          <Route
            path="/marketplace"
            element={
              <PermissionRoute view="countries">
                <MarketplacePage />
              </PermissionRoute>
            }
          />
        ) : null}
        {/* Module Mon établissement */}
        <Route
          path="/etablissement"
          element={
            <PermissionRoute view="establishment">
              <MonEtablissementLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<Navigate to="vue-ensemble" replace />} />
          <Route path="pilotage" element={<Navigate to="/etablissement/vue-ensemble" replace />} />
          <Route path="vue-ensemble" element={<EtablissementOverviewPage />} />
          <Route
            path="classes"
            element={
              <PermissionRoute view="classes">
                <EntityPage entity="classes" />
              </PermissionRoute>
            }
          />
          <Route
            path="classes/:className/eleves"
            element={
              <PermissionRoute view="students">
                <ClassStudentsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="affectations"
            element={<Navigate to="/etablissement/enseignants" replace />}
          />
          <Route path="matieres" element={<Navigate to="enseignants" replace />} />
          <Route
            path="eleves"
            element={
              <PermissionRoute view="students">
                <EntityPage entity="students" />
              </PermissionRoute>
            }
          />
          <Route
            path="enseignants"
            element={
              <PermissionRoute view="teachers">
                <EntityPage entity="teachers" />
              </PermissionRoute>
            }
          />
          <Route
            path="contacts"
            element={<Navigate to="/etablissement/comptes-utilisateurs" replace />}
          />
          <Route
            path="comptes-utilisateurs"
            element={
              <PermissionRoute view="users">
                <UsersPage />
              </PermissionRoute>
            }
          />
          <Route
            path="relations-parent-enfant"
            element={
              <PermissionRoute view="relations">
                <ParentChildRelationsPage />
              </PermissionRoute>
            }
          />
        </Route>
        {/* Anciennes URLs établissement -> onglets */}
        <Route path="/classes" element={<Navigate to="/etablissement/classes" replace />} />
        <Route path="/matieres" element={<Navigate to="/etablissement/enseignants" replace />} />
        <Route path="/eleves" element={<Navigate to="/etablissement/eleves" replace />} />
        <Route path="/enseignants" element={<Navigate to="/etablissement/enseignants" replace />} />
        <Route path="/contacts" element={<Navigate to="/etablissement/comptes-utilisateurs" replace />} />
        <Route path="/administration/contacts" element={<Navigate to="/etablissement/comptes-utilisateurs" replace />} />
        <Route path="/configuration/eleves" element={<Navigate to="/etablissement/eleves" replace />} />
        <Route
          path="/configuration/enseignants"
          element={<Navigate to="/etablissement/enseignants" replace />}
        />
        {/* Comptes utilisateurs établissement (Mon établissement) */}
        <Route
          path="/configuration/utilisateurs"
          element={<Navigate to="/etablissement/comptes-utilisateurs" replace />}
        />
        <Route path="/affectations" element={<Navigate to="/etablissement/enseignants" replace />} />
        <Route
          path="/planning"
          element={
            <PermissionRoute view="planning">
              <PlanningLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<Navigate to="emploi-du-temps" replace />} />
          <Route path="affectations" element={<Navigate to="/etablissement/enseignants" replace />} />
          <Route path="emploi-du-temps" element={<TimetableLayout />}>
            <Route index element={<Navigate to="calendrier" replace />} />
            <Route path="par-classe" element={<TimetableByClassPage />} />
            <Route path="par-enseignant" element={<TimetableByTeacherPage />} />
            <Route path="par-salle" element={<TimetableByRoomPage />} />
            <Route path="calendrier" element={<CoursePlanningPage />} />
          </Route>
          <Route path="salles" element={<PlanningRoomsPage />} />
          <Route path="remplacements" element={<PlanningSubstitutionsPage />} />
          <Route path="conflits" element={<PlanningConflictsPage />} />
        </Route>
        <Route path="/paiements" element={<Navigate to="/finances/paiements" replace />} />
        <Route
          path="/finances"
          element={
            <PermissionRoute view="payments">
              <FinancesLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<Navigate to="paiements" replace />} />
          <Route path="paiements" element={<EntityPage entity="payments" />} />
          <Route path="frais" element={<FinanceFeesPage />} />
          <Route path="impayes" element={<FinanceUnpaidPage />} />
        </Route>
        {/* Communication : pages autonomes accessibles via les icônes du Topbar */}
        <Route
          path="/messages"
          element={
            <PermissionRoute view="messages">
              <EntityPage entity="messages" />
            </PermissionRoute>
          }
        />
        <Route
          path="/annonces"
          element={
            <PermissionRoute view="announcements">
              <EntityPage entity="announcements" />
            </PermissionRoute>
          }
        />
        {/* Anciennes URLs du module Communication -> pages autonomes */}
        <Route path="/communication" element={<Navigate to="/messages" replace />} />
        <Route path="/communication/messages" element={<Navigate to="/messages" replace />} />
        <Route path="/communication/annonces" element={<Navigate to="/annonces" replace />} />
        <Route path="/conception-bulletins" element={<Navigate to="/parametres/documents" replace />} />
        <Route
          path="/presences"
          element={
            <PermissionRoute view="presences">
              <PresencesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/notes"
          element={
            <PermissionRoute view="notes">
              <GradesEvaluationsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/examens"
          element={
            <PermissionRoute view="exams">
              <EntityPage entity="exams" />
            </PermissionRoute>
          }
        />
        <Route
          path="/bulletins"
          element={
            <PermissionRoute view="bulletins">
              <EntityPage entity="bulletins" />
            </PermissionRoute>
          }
        />
        <Route path="/documents" element={<Navigate to="/administration/documents" replace />} />
        <Route
          path="/pays"
          element={
            <PermissionRoute view="countries">
              <CountriesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/etablissements"
          element={
            <PermissionRoute view="schools">
              <SchoolsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/abonnements"
          element={
            <PermissionRoute view="subscriptions">
              <SubscriptionsLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<Navigate to="etablissements" replace />} />
          <Route path="offres" element={<SubscriptionOffersPage />} />
          <Route path="etablissements" element={<SubscriptionSchoolsPage />} />
          <Route path="paiements" element={<SubscriptionPaymentsPage />} />
          <Route path="factures" element={<SubscriptionInvoicesPage />} />
          <Route path="remises" element={<SubscriptionDiscountsPage />} />
          <Route path="retards" element={<SubscriptionDelinquencyPage />} />
          <Route path="rapports" element={<SubscriptionReportsPage />} />
          <Route
            path="tarifs-pays"
            element={
              <PermissionRoute view="subscriptions">
                <SubscriptionPolicySettingsPage />
              </PermissionRoute>
            }
          />
        </Route>
        <Route
          path="/notifications"
          element={
            <PermissionRoute view="notifications">
              <NotificationsPage />
            </PermissionRoute>
          }
        />
        {/* Module Administration (onglets : Utilisateurs, Rôles & permissions, Documents, Conformité) */}
        <Route
          path="/administration"
          element={
            <PermissionRoute view="users">
              <AdministrationLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<Navigate to="utilisateurs" replace />} />
          <Route path="contacts" element={<Navigate to="/etablissement/comptes-utilisateurs" replace />} />
          <Route
            path="relations"
            element={
              <PermissionRoute view="relations">
                <EntityPage entity="relations" />
              </PermissionRoute>
            }
          />
          <Route path="utilisateurs" element={<UsersPage />} />
          <Route
            path="permissions"
            element={
              <PermissionRoute view="permissions">
                <PermissionsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="documents"
            element={
              <PermissionRoute view="documents">
                <EntityPage entity="documents" />
              </PermissionRoute>
            }
          />
          <Route
            path="conformite"
            element={
              <PermissionRoute view="reports">
                <ReportsPage />
              </PermissionRoute>
            }
          />
        </Route>
        {/* Anciennes URLs administration -> onglets */}
        <Route path="/utilisateurs" element={<Navigate to="/administration/utilisateurs" replace />} />
        <Route path="/permissions" element={<Navigate to="/administration/permissions" replace />} />
        <Route path="/rapports" element={<Navigate to="/administration/conformite" replace />} />

        {/* Module Paramètres : hub de cartes + pages dédiées par domaine de configuration */}
        <Route
          path="/parametres"
          element={
            <PermissionRoute view="settings">
              <ParametresLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<SettingsHubPage />} />
          <Route path="etablissement" element={<Navigate to="/parametres/annee-scolaire" replace />} />
          <Route
            path="profil"
            element={
              <PermissionRoute view="configuration">
                <SettingsProfilePage />
              </PermissionRoute>
            }
          />
          <Route
            path="annee-scolaire"
            element={
              <PermissionRoute view="configuration">
                <ConfigurationPage section="annee-scolaire" />
              </PermissionRoute>
            }
          />
          <Route
            path="structure"
            element={
              <PermissionRoute view="configuration">
                <ConfigurationPage section="structure" />
              </PermissionRoute>
            }
          />
          <Route
            path="roles-droits"
            element={
              <PermissionRoute view="configuration">
                <ConfigurationPage section="roles-droits" />
              </PermissionRoute>
            }
          />
          <Route path="utilisateurs" element={<Navigate to="/parametres/roles-droits" replace />} />
          <Route
            path="finances"
            element={
              <PermissionRoute view="configuration">
                <SettingsFinancePage />
              </PermissionRoute>
            }
          />
          <Route
            path="abonnements"
            element={
              <PermissionRoute view="subscriptions">
                <SubscriptionPolicySettingsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="notifications"
            element={
              <PermissionRoute view="configuration">
                <SettingsNotificationsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="documents"
            element={
              <PermissionRoute view="bulletinDesign">
                <BulletinDesignPage />
              </PermissionRoute>
            }
          />
          <Route
            path="graphiques"
            element={
              <PermissionRoute view="chartSettings">
                <ChartSettingsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="securite"
            element={
              <PermissionRoute view="configuration">
                <SettingsSecurityPage />
              </PermissionRoute>
            }
          />
          <Route
            path="apparence"
            element={
              <PermissionRoute view="configuration">
                <SettingsAppearancePage />
              </PermissionRoute>
            }
          />
          <Route
            path="integrations"
            element={
              <PermissionRoute view="configuration">
                <SettingsIntegrationsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="donnees"
            element={
              <PermissionRoute view="configuration">
                <SettingsDataPage />
              </PermissionRoute>
            }
          />
          <Route
            path="mon-abonnement"
            element={
              <PermissionRoute view="mySubscription">
                <MonAbonnementLayout />
              </PermissionRoute>
            }
          >
            <Route index element={<MonAbonnementPage />} />
            <Route path="factures" element={<MonAbonnementInvoicesPage />} />
            <Route path="paiements" element={<MonAbonnementPaymentsPage />} />
            <Route path="changer-offre" element={<ChangeOfferPage />} />
            <Route path="resiliation" element={<CancellationRequestPage />} />
          </Route>
        </Route>
        {/* Anciennes URLs paramètres -> hub / pages dédiées */}
        <Route path="/configuration" element={<Navigate to="/parametres" replace />} />
        <Route path="/parametres-graphiques" element={<Navigate to="/parametres/graphiques" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/tableau-de-bord" replace />} />
      </Routes>
    </Suspense>
  );
}
