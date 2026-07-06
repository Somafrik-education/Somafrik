import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PermissionRoute } from "./components/PermissionRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { DataProvider } from "./context/DataContext";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardEntryPage } from "./pages/DashboardEntryPage";
import { CountriesPage } from "./pages/CountriesPage";
import { SchoolsPage } from "./pages/SchoolsPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { UsersPage } from "./pages/UsersPage";
import { PermissionsPage } from "./pages/PermissionsPage";
import { ChartSettingsPage } from "./pages/ChartSettingsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import { EntityPage } from "./pages/EntityPage";
import { CoursePlanningPage } from "./pages/CoursePlanningPage";
import { PlanningLayout } from "./pages/planning/PlanningLayout";
import { TimetableLayout } from "./pages/planning/TimetableLayout";
import { TimetableByClassPage } from "./pages/planning/TimetableByClassPage";
import { TimetableByTeacherPage } from "./pages/planning/TimetableByTeacherPage";
import {
  PlanningRoomsPage,
  PlanningSubstitutionsPage,
  TimetableByRoomPage,
} from "./pages/planning/PlanningPlaceholders";
import { PlanningConflictsPage } from "./pages/planning/PlanningConflictsPage";
import { FinancesLayout } from "./pages/finances/FinancesLayout";
import { FinanceFeesPage, FinanceUnpaidPage } from "./pages/finances/FinancePlaceholders";
import { MonEtablissementLayout } from "./pages/etablissement/MonEtablissementLayout";
import { ParentChildRelationsPage } from "./pages/etablissement/ParentChildRelationsPage";
import { AdministrationLayout } from "./pages/administration/AdministrationLayout";
import { ParametresLayout } from "./pages/parametres/ParametresLayout";
import { SettingsHubPage } from "./pages/parametres/SettingsHubPage";
import { SubscriptionPolicySettingsPage } from "./pages/parametres/SubscriptionPolicySettingsPage";
import {
  SettingsAppearancePage,
  SettingsDataPage,
  SettingsFinancePage,
  SettingsIntegrationsPage,
  SettingsNotificationsPage,
  SettingsProfilePage,
  SettingsSecurityPage,
} from "./pages/parametres/SettingsPlaceholders";
import { BulletinDesignPage } from "./pages/BulletinDesignPage";
import { PresencesPage } from "./pages/PresencesPage";
import { ActiveSchoolProvider } from "./context/ActiveSchoolContext";

export default function App() {
  return (
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
        {/* Module Mon établissement */}
        <Route
          path="/etablissement"
          element={
            <PermissionRoute view="establishment">
              <MonEtablissementLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<Navigate to="classes" replace />} />
          <Route path="pilotage" element={<Navigate to="/etablissement/classes" replace />} />
          <Route
            path="classes"
            element={
              <PermissionRoute view="classes">
                <EntityPage entity="classes" />
              </PermissionRoute>
            }
          />
          <Route
            path="matieres"
            element={
              <PermissionRoute view="courses">
                <EntityPage entity="courses" />
              </PermissionRoute>
            }
          />
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
            element={
              <PermissionRoute view="contacts">
                <EntityPage entity="contacts" />
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
        <Route path="/matieres" element={<Navigate to="/etablissement/matieres" replace />} />
        <Route path="/eleves" element={<Navigate to="/etablissement/eleves" replace />} />
        <Route path="/enseignants" element={<Navigate to="/etablissement/enseignants" replace />} />
        <Route path="/contacts" element={<Navigate to="/etablissement/contacts" replace />} />
        <Route path="/administration/contacts" element={<Navigate to="/etablissement/contacts" replace />} />
        <Route path="/configuration/eleves" element={<Navigate to="/etablissement/eleves" replace />} />
        <Route
          path="/configuration/enseignants"
          element={<Navigate to="/etablissement/enseignants" replace />}
        />
        {/* Comptes utilisateurs (accessibles depuis le hub Paramètres) */}
        <Route
          path="/configuration/utilisateurs"
          element={
            <PermissionRoute view="users">
              <UsersPage />
            </PermissionRoute>
          }
        />
        <Route path="/affectations" element={<Navigate to="/etablissement/matieres" replace />} />
        <Route
          path="/planning"
          element={
            <PermissionRoute view="planning">
              <PlanningLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<Navigate to="emploi-du-temps" replace />} />
          <Route path="affectations" element={<Navigate to="/etablissement/matieres" replace />} />
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
              <EntityPage entity="notes" />
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
              <SubscriptionsPage />
            </PermissionRoute>
          }
        />
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
          <Route path="contacts" element={<Navigate to="/etablissement/contacts" replace />} />
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
            <PermissionRoute view="configuration">
              <ParametresLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<SettingsHubPage />} />
          <Route path="etablissement" element={<Navigate to="/parametres/annee-scolaire" replace />} />
          <Route path="profil" element={<SettingsProfilePage />} />
          <Route path="annee-scolaire" element={<ConfigurationPage section="annee-scolaire" />} />
          <Route path="structure" element={<ConfigurationPage section="structure" />} />
          <Route path="utilisateurs" element={<ConfigurationPage section="utilisateurs" />} />
          <Route path="finances" element={<SettingsFinancePage />} />
          <Route
            path="abonnements"
            element={
              <PermissionRoute view="subscriptions">
                <SubscriptionPolicySettingsPage />
              </PermissionRoute>
            }
          />
          <Route path="notifications" element={<SettingsNotificationsPage />} />
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
          <Route path="securite" element={<SettingsSecurityPage />} />
          <Route path="apparence" element={<SettingsAppearancePage />} />
          <Route path="integrations" element={<SettingsIntegrationsPage />} />
          <Route path="donnees" element={<SettingsDataPage />} />
        </Route>
        {/* Anciennes URLs paramètres -> hub / pages dédiées */}
        <Route path="/configuration" element={<Navigate to="/parametres" replace />} />
        <Route path="/parametres-graphiques" element={<Navigate to="/parametres/graphiques" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/tableau-de-bord" replace />} />
    </Routes>
  );
}
