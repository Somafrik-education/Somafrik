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
import { EstablishmentPage } from "./pages/EstablishmentPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import { EntityPage } from "./pages/EntityPage";
import { CoursePlanningPage } from "./pages/CoursePlanningPage";
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
        <Route
          path="/etablissement"
          element={
            <PermissionRoute view="establishment">
              <EstablishmentPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/configuration"
          element={
            <PermissionRoute view="configuration">
              <ConfigurationPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/configuration/eleves"
          element={
            <PermissionRoute view="students">
              <EntityPage entity="students" />
            </PermissionRoute>
          }
        />
        <Route
          path="/configuration/enseignants"
          element={
            <PermissionRoute view="teachers">
              <EntityPage entity="teachers" />
            </PermissionRoute>
          }
        />
        <Route
          path="/configuration/utilisateurs"
          element={
            <PermissionRoute view="users">
              <UsersPage />
            </PermissionRoute>
          }
        />
        <Route path="/eleves" element={<Navigate to="/configuration/eleves" replace />} />
        <Route path="/enseignants" element={<Navigate to="/configuration/enseignants" replace />} />
        <Route
          path="/classes"
          element={
            <PermissionRoute view="classes">
              <EntityPage entity="classes" />
            </PermissionRoute>
          }
        />
        <Route
          path="/matieres"
          element={
            <PermissionRoute view="courses">
              <EntityPage entity="courses" />
            </PermissionRoute>
          }
        />
        <Route
          path="/affectations"
          element={
            <PermissionRoute view="assignments">
              <EntityPage entity="assignments" />
            </PermissionRoute>
          }
        />
        <Route
          path="/planning"
          element={
            <PermissionRoute view="planning">
              <CoursePlanningPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/paiements"
          element={
            <PermissionRoute view="payments">
              <EntityPage entity="payments" />
            </PermissionRoute>
          }
        />
        <Route
          path="/messages"
          element={
            <PermissionRoute view="messages">
              <EntityPage entity="messages" />
            </PermissionRoute>
          }
        />
        <Route
          path="/conception-bulletins"
          element={
            <PermissionRoute view="bulletinDesign">
              <BulletinDesignPage />
            </PermissionRoute>
          }
        />
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
        <Route
          path="/documents"
          element={
            <PermissionRoute view="documents">
              <EntityPage entity="documents" />
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
        <Route
          path="/utilisateurs"
          element={
            <PermissionRoute view="users">
              <UsersPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/permissions"
          element={
            <PermissionRoute view="permissions">
              <PermissionsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/parametres-graphiques"
          element={
            <PermissionRoute view="chartSettings">
              <ChartSettingsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/rapports"
          element={
            <PermissionRoute view="reports">
              <ReportsPage />
            </PermissionRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/tableau-de-bord" replace />} />
    </Routes>
  );
}
