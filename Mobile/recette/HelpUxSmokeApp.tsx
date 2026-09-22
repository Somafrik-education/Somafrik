import { useMemo, useState, type ReactNode } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AuthContext, type AuthContextValue } from "../src/context/AuthContext";
import { HelpHost } from "../src/help/HelpHost";
import { HelpUiProvider } from "../src/help/HelpUiContext";
import { navigationRef } from "../src/navigation/rootNavigation";
import RoleNavigationDrawer from "../src/components/RoleNavigationDrawer";
import { MIN_TOUCH_TARGET_DP } from "../src/lib/mobileUsability";
import { TAB_BAR_CONTENT_HEIGHT } from "../src/lib/mobileUxV1Layout";
import {
  createHelpUxSmokeSession,
  installHelpUxSmokeRuntime,
} from "./helpUxSmoke";

const Stack = createNativeStackNavigator();

function HelpUxSmokeAuthProvider({ children }: { children: ReactNode }) {
  const session = useMemo(() => createHelpUxSmokeSession(), []);
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

function HelpUxSmokeHome({ navigation }: { navigation: any }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <View style={styles.screen} testID="help-ux-smoke-home">
      <View style={styles.header} testID="mobile-app-header">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir le menu"
          testID="mobile-header-menu"
          onPress={() => setDrawerOpen(true)}
          style={styles.menu}
        >
          <Ionicons name="menu" size={32} color="#0F172A" />
        </Pressable>
        <Text style={styles.school} numberOfLines={1}>
          Lycée Somafrik Recette
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.muted}>Tableau de bord</Text>
          <Text style={styles.kpi}>Présences du jour</Text>
          <Text style={styles.muted}>Recette runtime — composants RN de production</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.muted}>Paiements</Text>
          <Text style={styles.kpi}>Encaissements</Text>
        </View>
      </View>
      <View style={styles.tabs}>
        <Text style={styles.tabActive}>Accueil</Text>
        <Text style={styles.tab}>Classes</Text>
        <Text style={styles.tab}>Élèves</Text>
        <Text style={styles.tab}>Présences</Text>
      </View>
      <RoleNavigationDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigation={navigation}
      />
    </View>
  );
}

export default function HelpUxSmokeApp() {
  installHelpUxSmokeRuntime();
  return (
    <HelpUxSmokeAuthProvider>
      <HelpUiProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: "#F8FAFC" } }}
          >
            <Stack.Screen name="Home" component={HelpUxSmokeHome} />
          </Stack.Navigator>
          <HelpHost />
        </NavigationContainer>
      </HelpUiProvider>
    </HelpUxSmokeAuthProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    minHeight: 76,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  menu: {
    width: 48,
    height: 48,
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
  },
  school: { flex: 1, color: "#0F172A", fontSize: 15, fontWeight: "700" },
  body: { flex: 1, padding: 16 },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  muted: { color: "#64748B", fontSize: 13, fontWeight: "600" },
  kpi: { color: "#0F172A", fontSize: 20, fontWeight: "800", marginTop: 4 },
  tabs: {
    height: TAB_BAR_CONTENT_HEIGHT + 20,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  tab: { color: "#64748B", fontSize: 10, fontWeight: "700" },
  tabActive: { color: "#2563EB", fontSize: 10, fontWeight: "700" },
});
