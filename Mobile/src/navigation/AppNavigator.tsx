import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { ROLE_SELECTION_NAV_TITLE } from "../lib/roleSelectionLayout";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { navigationRef } from "./rootNavigation";
import { flushPendingPushNavigation } from "../lib/pushNotificationTap";

import RoleSelectionScreen from "../screens/RoleSelectionScreen";
import WelcomeScreen from "../screens/WelcomeScreen";
import LoginScreen from "../screens/LoginScreen";
import BottomTabsNavigator from "./BottomTabsNavigator";

import StudentsScreen from "../screens/StudentsScreen";
import SchoolManagementScreen from "../screens/SchoolManagementScreen";
import ClassesScreen from "../screens/ClassesScreen";
import StudentDetailScreen from "../screens/StudentDetailScreen";
import StudentNotesScreen from "../screens/StudentNotesScreen";
import StudentPresencesScreen from "../screens/StudentPresencesScreen";
import StudentPaymentsScreen from "../screens/StudentPaymentsScreen";
import TeachersScreen from "../screens/TeachersScreen";
import UsersScreen from "../screens/UsersScreen";
import PaymentsScreen from "../screens/PaymentsScreen";
import AnnouncementsScreen from "../screens/AnnouncementsScreen";
import SafeAdminCrudScreen from "../screens/SafeAdminCrudScreen";
import MessagesScreen from "../screens/MessagesScreen";
import TimetableScreen from "../screens/TimetableScreen";
import ReportCardsScreen from "../screens/ReportCardsScreen";
import TeacherAttendanceScreen from "../screens/TeacherAttendanceScreen";
import TeacherGradesScreen from "../screens/TeacherGradesScreen";
import {
  AuditScreen,
  DocumentsScreen,
  MobilePaymentScreen,
  OfflineModeScreen,
  ReportsScreen,
  SupportScreen,
  SynchronizationScreen,
} from "../screens/MvpUtilityScreens";
import PermissionsScreen from "../screens/PermissionsScreen";
import ConfigurationScreen from "../screens/ConfigurationScreen";
import EstablishmentProfileScreen from "../screens/EstablishmentProfileScreen";
import SchoolYearSettingsScreen from "../screens/SchoolYearSettingsScreen";
import SchoolPedagogicalStructureScreen from "../screens/SchoolPedagogicalStructureScreen";
import SchoolAssignableRolesScreen from "../screens/SchoolAssignableRolesScreen";
import PlatformNotificationsScreen from "../screens/PlatformNotificationsScreen";
import InternalNotificationsScreen from "../screens/InternalNotificationsScreen";
import OfflineBanner from "../components/OfflineBanner";
import { AdminEntity } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { canAccessMessagesRoute } from "../lib/mobileCtaRbacAlignment";
import { isMetierRenderable } from "../lib/livePermissionsRefresh";

export type UserRole = string;

export type RootStackParamList = {
  Welcome: undefined;
  RoleSelection: undefined;
  Login: {
    school?: {
      id?: string;
      publicId?: string;
      code: string;
      name: string;
      city: string;
      slogan?: string;
      logoUrl?: string;
    };
    platformContext?: {
      kind: "global" | "country";
      countryCode?: string;
    };
    accessIdentifier?: string;
    accessRole?: UserRole;
    accessRoleLabel?: string;
  };
  Home: { role: UserRole };
  Students: { className?: string };
  StudentDetail: { studentId: string };
  StudentNotes: { studentId: string };
  StudentPresences: { studentId: string };
  StudentPayments: { studentId: string };
  SchoolManagement: undefined;
  Classes: undefined;
  Teachers: undefined;
  Users: undefined;
  TeacherStudents: undefined;
  TeacherAttendance: undefined;
  TeacherGrades: undefined;
  Payments: undefined;
  Announcements: undefined;
  Messages: undefined;
  Timetable: undefined;
  ReportCards: undefined;
  Documents: undefined;
  Reports: undefined;
  Audit: undefined;
  Support: undefined;
  MobilePayment: undefined;
  OfflineMode: undefined;
  Synchronization: undefined;
  Configuration: undefined;
  EstablishmentProfile: undefined;
  SchoolYearSettings: undefined;
  SchoolPedagogicalStructure: undefined;
  SchoolAssignableRoles: undefined;
  PlatformNotifications: undefined;
  InternalNotifications: undefined;
  Permissions: undefined;
  AdminCrud: {
    entity: AdminEntity;
    filter?: "paid" | "pending";
    className?: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeTabs() {
  const { session, permissionsBootstrap } = useAuth();

  // Défense en profondeur : aucune coque métier sans session authentifiée
  // et permissions live ready, ou snapshot offline validé (ready_offline).
  if (!isMetierRenderable(session, permissionsBootstrap)) {
    return <View style={{ flex: 1, backgroundColor: "#F8FAFC" }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ flex: 1 }}>
        <BottomTabsNavigator />
      </View>
    </View>
  );
}

function PermissionsBootstrapScreen({
  error,
  onRetry,
  onLogout,
}: {
  error?: string | null;
  onRetry?: () => void;
  onLogout?: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#F8FAFC",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 28,
      }}
    >
      {error ? (
        <>
          <Text style={{ color: "#0F172A", fontSize: 20, fontWeight: "800", textAlign: "center" }}>
            Permissions indisponibles
          </Text>
          <Text style={{ color: "#64748B", fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 10 }}>
            {error}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onRetry}
            style={{
              marginTop: 22,
              minHeight: 48,
              minWidth: 180,
              borderRadius: 14,
              backgroundColor: "#2563EB",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 20,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 16 }}>Réessayer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onLogout}
            style={{ marginTop: 12, minHeight: 44, justifyContent: "center", paddingHorizontal: 18 }}
          >
            <Text style={{ color: "#475569", fontWeight: "700" }}>Se déconnecter</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={{ color: "#475569", fontSize: 15, fontWeight: "600", marginTop: 14 }}>
            Vérification des droits…
          </Text>
        </>
      )}
    </View>
  );
}

export default function AppNavigator() {
  const {
    session,
    bootstrapping,
    permissionsBootstrap,
    permissionsBootstrapError,
    refreshEffectivePermissions,
    logout,
  } = useAuth();

  if (bootstrapping) {
    return <View style={{ flex: 1, backgroundColor: "#F8FAFC" }} />;
  }

  if (session && (permissionsBootstrap === "idle" || permissionsBootstrap === "loading")) {
    return <PermissionsBootstrapScreen />;
  }

  if (session && permissionsBootstrap === "error") {
    return (
      <PermissionsBootstrapScreen
        error={permissionsBootstrapError}
        onRetry={() => {
          void refreshEffectivePermissions();
        }}
        onLogout={logout}
      />
    );
  }

  // Chaque écran reste filtré par canReadRoute. SchoolManagement n'ouvre plus
  // le bundle par identité établissement : seul Établissements:READ le déclenche.
  const canOpenAdminCrud =
    canReadRoute(session, "SchoolManagement") ||
    canReadRoute(session, "Teachers") ||
    canReadView(session, "users") ||
    canReadRoute(session, "Payments");
  const canOpenStudentScreens =
    canReadRoute(session, "StudentDetail") ||
    canReadRoute(session, "StudentNotes") ||
    canReadRoute(session, "StudentPresences");

  return (
    <NavigationContainer
      ref={navigationRef}
      key={session ? "authenticated" : "public"}
      onReady={() => {
        flushPendingPushNavigation(
          (destination) => navigationRef.navigate(destination as never),
          () => navigationRef.isReady(),
        );
      }}
    >
      <Stack.Navigator initialRouteName={session ? "Home" : "Welcome"}>
        <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="RoleSelection"
          component={RoleSelectionScreen}
          options={{
            title: ROLE_SELECTION_NAV_TITLE,
            headerTitleAlign: "center",
            headerTitleStyle: { fontSize: 18, fontWeight: "700" },
          }}
        />
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />

        {canOpenAdminCrud && (
          <>
            {session?.role !== "school_admin" && canReadRoute(session, "SchoolManagement") && (
              <Stack.Screen name="SchoolManagement" component={SchoolManagementScreen} options={{ title: "Gestion de l'établissement" }} />
            )}
            {canReadRoute(session, "Teachers") && (
              <Stack.Screen name="Teachers" component={TeachersScreen} options={{ title: "Enseignants" }} />
            )}
            {canReadView(session, "users") && <Stack.Screen name="Users" component={UsersScreen} options={{ title: "Utilisateurs" }} />}
            {canReadRoute(session, "Payments") && (
              <Stack.Screen name="Payments" component={PaymentsScreen} options={{ title: "Paiements" }} />
            )}
            <Stack.Screen name="AdminCrud" component={SafeAdminCrudScreen} options={{ title: "Administration" }} />
          </>
        )}

        {canReadRoute(session, "Classes") && <Stack.Screen name="Classes" component={ClassesScreen} options={{ title: "Classes" }} />}
        {canReadRoute(session, "Students") && <Stack.Screen name="Students" component={StudentsScreen} options={{ title: "Élèves" }} />}
        {canReadRoute(session, "TeacherStudents") && <Stack.Screen name="TeacherStudents" component={StudentsScreen} options={{ title: "Mes élèves" }} />}
        {canReadRoute(session, "TeacherAttendance") && <Stack.Screen name="TeacherAttendance" component={TeacherAttendanceScreen} options={{ title: "Appel" }} />}
        {canReadRoute(session, "TeacherGrades") && <Stack.Screen name="TeacherGrades" component={TeacherGradesScreen} options={{ title: "Notes" }} />}

        {canOpenStudentScreens && (
          <>
            {canReadRoute(session, "StudentDetail") && (
              <Stack.Screen name="StudentDetail" component={StudentDetailScreen} options={{ title: "Fiche élève" }} />
            )}
            {canReadRoute(session, "StudentNotes") && <Stack.Screen name="StudentNotes" component={StudentNotesScreen} options={{ title: "Notes" }} />}
            {canReadRoute(session, "StudentPresences") && <Stack.Screen name="StudentPresences" component={StudentPresencesScreen} options={{ title: "Présences" }} />}
          </>
        )}

        {canReadRoute(session, "StudentPayments") && <Stack.Screen name="StudentPayments" component={StudentPaymentsScreen} options={{ title: "Paiements" }} />}
        {canReadRoute(session, "Announcements") && (
          <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ title: "Annonces" }} />
        )}
        {canAccessMessagesRoute(session) && <Stack.Screen name="Messages" component={MessagesScreen} options={{ title: "Messages" }} />}

        {(canReadRoute(session, "Timetable") || canReadRoute(session, "ReportCards")) && (
          <>
            {canReadRoute(session, "Timetable") && <Stack.Screen name="Timetable" component={TimetableScreen} options={{ title: "Emploi du temps" }} />}
            {canReadRoute(session, "ReportCards") && <Stack.Screen name="ReportCards" component={ReportCardsScreen} options={{ title: "Bulletins" }} />}
          </>
        )}

        {canReadRoute(session, "Documents") && <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: "Documents" }} />}
        {canReadRoute(session, "Reports") && <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: "Rapports" }} />}
        {canReadRoute(session, "Audit") && <Stack.Screen name="Audit" component={AuditScreen} options={{ title: "Audit" }} />}
        {canReadRoute(session, "MobilePayment") && <Stack.Screen name="MobilePayment" component={MobilePaymentScreen} options={{ title: "Paiement mobile" }} />}
        {canReadRoute(session, "OfflineMode") && <Stack.Screen name="OfflineMode" component={OfflineModeScreen} options={{ title: "Mode hors ligne" }} />}
        {canReadRoute(session, "Synchronization") && <Stack.Screen name="Synchronization" component={SynchronizationScreen} options={{ title: "Synchronisation" }} />}
        {canReadRoute(session, "Support") && <Stack.Screen name="Support" component={SupportScreen} options={{ title: "Support" }} />}
        {canReadView(session, "Configuration") && <Stack.Screen name="Configuration" component={ConfigurationScreen} options={{ title: "Paramètres" }} />}
        {canReadView(session, "EstablishmentProfile") && (
          <Stack.Screen name="EstablishmentProfile" component={EstablishmentProfileScreen} options={{ title: "Profil établissement" }} />
        )}
        {canReadView(session, "SchoolYearSettings") && (
          <Stack.Screen name="SchoolYearSettings" component={SchoolYearSettingsScreen} options={{ title: "Année scolaire" }} />
        )}
        {canReadView(session, "SchoolPedagogicalStructure") && (
          <Stack.Screen
            name="SchoolPedagogicalStructure"
            component={SchoolPedagogicalStructureScreen}
            options={{ title: "Structure pédagogique" }}
          />
        )}
        {canReadView(session, "SchoolAssignableRoles") && (
          <Stack.Screen name="SchoolAssignableRoles" component={SchoolAssignableRolesScreen} options={{ title: "Rôles disponibles" }} />
        )}
        {canReadRoute(session, "InternalNotifications") && <Stack.Screen name="InternalNotifications" component={InternalNotificationsScreen} options={{ title: "Notifications" }} />}
        {canReadView(session, "PlatformNotifications") && <Stack.Screen name="PlatformNotifications" component={PlatformNotificationsScreen} options={{ title: "Notifications plateforme" }} />}
        {canReadView(session, "Permissions") && <Stack.Screen name="Permissions" component={PermissionsScreen} options={{ title: "Droits par rôle" }} />}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
