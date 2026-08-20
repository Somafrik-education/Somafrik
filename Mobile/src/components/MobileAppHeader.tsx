import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import RoleNavigationDrawer from "./RoleNavigationDrawer";

export default function MobileAppHeader({ navigation }: { navigation: any }) {
  const { session } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const schoolName = session?.school?.name ?? session?.user?.schoolCode ?? "Somafrik";
  const contextLabel = session?.school?.city ?? roleLabel(session?.role);

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
      <View style={styles.container} testID="mobile-app-header">
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => setDrawerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir le menu"
          testID="mobile-header-menu"
        >
          <Ionicons name="menu" size={28} color="#0F172A" />
        </TouchableOpacity>

        <View style={styles.context}>
          <Text style={styles.schoolName} numberOfLines={1} testID="mobile-header-school-name">
            {schoolName}
          </Text>
          <Text style={styles.contextLabel} numberOfLines={1}>{contextLabel}</Text>
        </View>

        <View style={styles.actions}>
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
      <Ionicons name={icon} size={21} color="#334155" />
    </TouchableOpacity>
  );
}

function roleLabel(role?: string) {
  switch (role) {
    case "super_admin": return "Administration Somafrik";
    case "country_admin": return "Administration pays";
    case "school_admin": return "Administration établissement";
    case "principal": return "Direction";
    case "prefet": return "Préfet des études";
    case "secretary": return "Secrétariat";
    case "teacher": return "Espace enseignant";
    case "parent_student": return "Espace parent";
    case "student": return "Espace élève";
    default: return "Somafrik";
  }
}

const styles = StyleSheet.create({
  container: {
    minHeight: 64,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  menuButton: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  context: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  schoolName: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  contextLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
  },
  actionButton: {
    width: MIN_TOUCH_TARGET_DP,
    height: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
