import { useMemo, type ReactNode } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import { AdminDataProvider } from "../src/context/AdminDataContext";
import { AuthContext, type AuthContextValue } from "../src/context/AuthContext";
import { createCommunicationUxSmokeSession, installCommunicationUxSmokeFetch } from "./communicationUxSmoke";
import AnnouncementsScreen from "../src/screens/AnnouncementsScreen";
import InternalNotificationsScreen from "../src/screens/InternalNotificationsScreen";
import MessagesScreen from "../src/screens/MessagesScreen";

const Stack = createNativeStackNavigator();

function CommunicationUxSmokeAuthProvider({ children }: { children: ReactNode }) {
  const session = useMemo(() => createCommunicationUxSmokeSession(), []);
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      selectedStudentId: null,
      bootstrapping: false,
      permissionsBootstrap: "ready",
      permissionsBootstrapError: null,
      setSession: () => undefined,
      setSelectedStudentId: () => undefined,
      refreshEffectivePermissions: async () => true,
      logout: () => undefined,
    }),
    [session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function SmokeBanner() {
  return (
    <View testID="communication-ux-smoke-banner" style={styles.banner}>
      <Text style={styles.bannerText}>
        Expo / React Native (cible web) — Messages, Annonces, Notifications
      </Text>
    </View>
  );
}

export default function CommunicationUxSmokeApp() {
  installCommunicationUxSmokeFetch();
  return (
    <CommunicationUxSmokeAuthProvider>
      <AdminDataProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Announcements"
            screenOptions={{
              header: () => <SmokeBanner />,
              animation: "none",
              contentStyle: { backgroundColor: "#F8FAFC" },
            }}
          >
            <Stack.Screen name="Messages" component={MessagesScreen} />
            <Stack.Screen name="Announcements" component={AnnouncementsScreen} />
            <Stack.Screen name="InternalNotifications" component={InternalNotificationsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AdminDataProvider>
    </CommunicationUxSmokeAuthProvider>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#0F172A",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerText: { color: "#F8FAFC", fontSize: 11, fontWeight: "700" },
});
