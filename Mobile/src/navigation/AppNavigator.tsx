import { View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

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
import PaymentsScreen from "../screens/PaymentsScreen";
import AnnouncementsScreen from "../screens/AnnouncementsScreen";
import AdminCrudScreen from "../screens/AdminCrudScreen";
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
import PlatformNotificationsScreen from "../screens/PlatformNotificationsScreen";
import OfflineBanner from "../components/OfflineBanner";
import { AdminEntity } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { canReadRoute, canReadView } from "../domain/security/permissions";

export type UserRole =
  | "super_admin"
  | "country_admin"
  | "school_admin"
  | "principal"
  | "prefet"
  | "secretary"
  | "teacher"
  | "parent_student"
  | "student";

export type RootStackParamList = {
  Welcome: undefined;
  RoleSelection: undefined;
  Login: {
    school: {
      id?: string;
      publicId?: string;
      code: string;
      name: string;
      city: string;
      slogan?: string;
      logoUrl?: string;
    };
    accessIdentifier?: string;
    accessRole?: UserRole;
    accessRoleLabel?: string;
  };
  Home: {
    role: UserRole;
  };
  Students: {
    className?: string;
  };
  StudentDetail: {
    studentId: string;
  };
  StudentNotes: {
    studentId: string;
  };
  StudentPresences: {
    studentId: string;
  };
  StudentPayments: {
    studentId: string;
  };
  SchoolManagement: undefined;
  Classes: undefined;
  Teachers: undefined;
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
  PlatformNotifications: undefined;
  Permissions: undefined;
  AdminCrud: {
    entity: AdminEntity;
    filter?: "paid" | "pending";
    className?: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeTabs() {
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ flex: 1 }}>
        <BottomTabsNavigator />
      </View>
    </View>
  );
}

export default function AppNavigator() {
  const { session, bootstrapping } = useAuth();
  const role = session?.role;

  if (bootstrapping) {
    return <View style={{ flex: 1, backgroundColor: "#F8FAFC" }} />;
  }
  const isSuperAdmin = role === "super_admin";
  const isCountryAdmin = role === "country_admin";
  const isSchoolAdmin = role === "school_admin";
  const isAdmin = isSuperAdmin || isCountryAdmin || isSchoolAdmin;
  const isPedagogicalStaff = role === "principal" || role === "prefet";
  const isSecretary = role === "secretary";
  const canOpenAdminCrud = isAdmin || isPedagogicalStaff || isSecretary;
  const canOpenStudentScreens =
    canReadRoute(session, "StudentDetail") ||
    canReadRoute(session, "StudentNotes") ||
    canReadRoute(session, "StudentPresences");

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Welcome">
        <Stack.Screen
          name="Welcome"
          component={WelcomeScreen}
          options={{ headerShown: false }}
        />

        <Stack.Screen
          name="RoleSelection"
          component={RoleSelectionScreen}
          options={{ title: "Se connecter à l'établissement" }}
        />

        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />

        <Stack.Screen
          name="Home"
          component={HomeTabs}
          options={{ headerShown: false }}
        />

        {canOpenAdminCrud && (
          <>
            {session?.role !== "school_admin" && canReadRoute(session, "SchoolManagement") && <Stack.Screen name="SchoolManagement" component={SchoolManagementScreen} />}
            {canReadRoute(session, "Teachers") && <Stack.Screen name="Teachers" component={TeachersScreen} />}
            {canReadRoute(session, "Payments") && <Stack.Screen name="Payments" component={PaymentsScreen} />}
            <Stack.Screen name="AdminCrud" component={AdminCrudScreen} options={{ title: "Administration" }} />
          </>
        )}

        {canReadRoute(session, "Classes") && (
          <>
            <Stack.Screen name="Classes" component={ClassesScreen} />
          </>
        )}

        {canReadRoute(session, "Students") && (
          <>
            <Stack.Screen name="Students" component={StudentsScreen} options={{ title: "Élèves" }} />
          </>
        )}

        {canReadRoute(session, "TeacherStudents") && (
          <Stack.Screen name="TeacherStudents" component={StudentsScreen} options={{ title: "Mes élèves" }} />
        )}

        {canReadRoute(session, "TeacherAttendance") && (
          <Stack.Screen name="TeacherAttendance" component={TeacherAttendanceScreen} options={{ title: "Appel" }} />
        )}

        {canReadRoute(session, "TeacherGrades") && (
          <Stack.Screen name="TeacherGrades" component={TeacherGradesScreen} options={{ title: "Notes" }} />
        )}

        {canOpenStudentScreens && (
          <>
            {canReadRoute(session, "StudentDetail") && <Stack.Screen name="StudentDetail" component={StudentDetailScreen} />}
            {canReadRoute(session, "StudentNotes") && <Stack.Screen name="StudentNotes" component={StudentNotesScreen} options={{ title: "Notes" }} />}
            {canReadRoute(session, "StudentPresences") && <Stack.Screen name="StudentPresences" component={StudentPresencesScreen} options={{ title: "Présences" }} />}
          </>
        )}

        {canReadRoute(session, "StudentPayments") && (
          <Stack.Screen name="StudentPayments" component={StudentPaymentsScreen} options={{ title: "Paiements" }} />
        )}

        {canReadRoute(session, "Announcements") && (
          <Stack.Screen name="Announcements" component={AnnouncementsScreen} />
        )}

        {canReadRoute(session, "Messages") && (
          <Stack.Screen name="Messages" component={MessagesScreen} options={{ title: "Messages" }} />
        )}

        {(canReadRoute(session, "Timetable") || canReadRoute(session, "ReportCards")) && (
          <>
            {canReadRoute(session, "Timetable") && <Stack.Screen name="Timetable" component={TimetableScreen} options={{ title: "Emploi du temps" }} />}
            {canReadRoute(session, "ReportCards") && <Stack.Screen name="ReportCards" component={ReportCardsScreen} options={{ title: "Bulletins" }} />}
          </>
        )}

        {canReadRoute(session, "Documents") && (
          <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: "Documents" }} />
        )}
        {canReadRoute(session, "Reports") && (
          <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: "Rapports" }} />
        )}
        {canReadRoute(session, "Audit") && (
          <Stack.Screen name="Audit" component={AuditScreen} options={{ title: "Audit" }} />
        )}
        {canReadRoute(session, "MobilePayment") && (
          <Stack.Screen name="MobilePayment" component={MobilePaymentScreen} options={{ title: "Paiement mobile" }} />
        )}
        {canReadRoute(session, "OfflineMode") && (
          <Stack.Screen name="OfflineMode" component={OfflineModeScreen} options={{ title: "Mode hors ligne" }} />
        )}
        {canReadRoute(session, "Synchronization") && (
          <Stack.Screen name="Synchronization" component={SynchronizationScreen} options={{ title: "Synchronisation" }} />
        )}
        {canReadRoute(session, "Support") && (
          <Stack.Screen name="Support" component={SupportScreen} options={{ title: "Support" }} />
        )}
        {canReadView(session, "Configuration") && (
          <Stack.Screen name="Configuration" component={ConfigurationScreen} options={{ title: "Configuration" }} />
        )}
        {canReadView(session, "PlatformNotifications") && (
          <Stack.Screen
            name="PlatformNotifications"
            component={PlatformNotificationsScreen}
            options={{ title: "Notifications plateforme" }}
          />
        )}
        {canReadView(session, "Permissions") && (
          <Stack.Screen name="Permissions" component={PermissionsScreen} options={{ title: "Droits par rôle" }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
