import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { COMPACT_HEADER_ROW_DP, HEADER_ACTIONS_SLOT_DP } from "../lib/mobileUxV1Layout";
import RoleNavigationDrawer from "./RoleNavigationDrawer";

export default function MobileAppHeader({ navigation }: { navigation: any }) {
  const { session } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const schoolName = session?.school?.name ?? session?.user?.schoolCode ?? "Somafrik";

  const syncRoute = canReadRoute(session, "Synchronization")
    ? "Synchronization"
    : canReadRoute(session, "OfflineMode")
      ? "OfflineMode"
      : null;

  const searchRoute = useMemo(() => {
    if (canReadRoute(session, "TeacherStudents")) return "TeacherStudents";
    if (canReadRoute(session, "Students")) return "Students";
    if (canReadRoute(session, "Users")) return "Users";
    if (canReadRoute(session, "Classes")) return "Classes";
    return null;
  }, [session]);

  const notificationsRoute = canReadView(session, "PlatformNotifications")
    ? "PlatformNotifications"
    : canReadRoute(session, "Announcements")
      ? "Announcements"
      : canReadRoute(session, "Messages")
        ? "Messages"
        : null;

  const rootNavigation = navigation.getParent?.() ?? navigation;
  const openRootRoute = (route: string) => rootNavigation.navigate(route);

  return (
    <>
      <SafeAreaView edges={["top"]} style={styles.safe} testID="mobile-app-header">
        <View style={styles.row}>
          <View style={styles.sideSlot}>
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => setDrawerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir le menu"
              testID="mobile-header-menu"
            >
              <Ionicons name="menu" size={22} color="#0F172A" />
            </TouchableOpacity>
          </View>

          <View style={styles.context}>
            <Text
              style={styles.schoolName}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              testID="mobile-header-school-name"
            >
              {schoolName}
            </Text>
          </View>

          <View style={[styles.sideSlot, styles.actionsSlot]}>
            {syncRoute ? (
              <HeaderAction
                icon="sync-outline"
                label="Synchroniser"
                testID="mobile-header-sync"
                onPress={() => openRootRoute(syncRoute)}
              />
            ) : null}
            {searchRoute ? (
              <HeaderAction
                icon="search-outline"
                label="Rechercher"
                testID="mobile-header-search"
                onPress={() => openRootRoute(searchRoute)}
              />
            ) : null}
            {notificationsRoute ? (
              <HeaderAction
                icon="notifications-outline"
                label="Notifications"
                testID="mobile-header-notifications"
                onPress={() => openRootRoute(notificationsRoute)}
              />
            ) : null}
          </View>
        </View>
      </SafeAreaView>

      <RoleNavigationDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigation={navigation}
      />
    </>
  );
}

function HeaderAction({
  icon,
  label,
  testID,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      activeOpacity={0.82}
    >
      <Ionicons name={icon} size={20} color="#334155" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
    zIndex: 30,
  },
  row: {
    minHeight: COMPACT_HEADER_ROW_DP,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  sideSlot: {
    width: HEADER_ACTIONS_SLOT_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    flexDirection: "row",
    alignItems: "center",
  },
  menuButton: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
  },
  context: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  schoolName: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    width: "100%",
  },
  actionsSlot: {
    justifyContent: "flex-end",
  },
  actionButton: {
    width: MIN_TOUCH_TARGET_DP,
    height: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
  },
});
