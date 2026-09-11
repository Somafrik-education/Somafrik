import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import { AdminDataProvider } from "../context/AdminDataContext";
import { CommunicationUxSmokeAuthProvider } from "../context/AuthContext";
import {
  installCommunicationUxSmokeFetch,
  isCommunicationUxSmokeEnabled,
} from "../lib/communicationUxSmoke";
import AnnouncementsScreen from "./AnnouncementsScreen";
import InternalNotificationsScreen from "./InternalNotificationsScreen";
import MessagesScreen from "./MessagesScreen";

const Stack = createNativeStackNavigator();

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
  if (!isCommunicationUxSmokeEnabled()) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>Harnais Communication UX inactif.</Text>
      </View>
    );
  }
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
  blocked: { flex: 1, alignItems: "center", justifyContent: "center" },
  blockedText: { color: "#B91C1C", fontWeight: "700" },
});
