import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canReadRoute } from "../domain/security/permissions";
import { canAccessMessagesRoute } from "../lib/mobileCtaRbacAlignment";
import { resolveNotificationsInboxRoute } from "../lib/notificationInboxRoute";
import { useInternalNotificationsUnreadCount } from "../lib/internalNotificationsRead";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  COMPACT_HEADER_ROW_DP,
  HEADER_ACTIONS_SLOT_DP,
  HEADER_BADGE_BAND_DP,
  HEADER_MENU_ICON_DP,
  HEADER_MENU_SLOT_DP,
  HEADER_MENU_TOUCH_DP,
} from "../lib/mobileUxV1Layout";
import { shouldShowEnvironmentBadge } from "../config/env";
import RoleNavigationDrawer from "./RoleNavigationDrawer";

export default function MobileAppHeader({ navigation }: { navigation: any }) {
  const { session } = useAuth();
  const { activeSchoolCode } = useAdminData();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const schoolName = session?.school?.name ?? session?.user?.schoolCode ?? "Somafrik";
  const resolvedNotificationsInboxRoute = resolveNotificationsInboxRoute(session, activeSchoolCode);
  // #577 L0 : la messagerie plateforme reste réservée au Web. Le header Mobile
  // n'expose que la boîte interne d'un établissement réellement sélectionné.
  const notificationsInboxRoute =
    resolvedNotificationsInboxRoute === "InternalNotifications"
      ? resolvedNotificationsInboxRoute
      : null;
  const canInternalNotifications = notificationsInboxRoute === "InternalNotifications";
  const { count: internalUnread } = useInternalNotificationsUnreadCount(
    canInternalNotifications,
    activeSchoolCode,
  );

  const syncRoute = canReadRoute(session, "Synchronization")
    ? "Synchronization"
    : canReadRoute(session, "OfflineMode")
      ? "OfflineMode"
      : null;

  const notificationsRoute = notificationsInboxRoute
    ?? (canReadRoute(session, "Announcements")
      ? "Announcements"
      : canAccessMessagesRoute(session)
        ? "Messages"
        : null);

  const rootNavigation = navigation.getParent?.() ?? navigation;
  const openRootRoute = (route: string) => rootNavigation.navigate(route);

  return (
    <>
      <SafeAreaView edges={["top"]} style={styles.safe} testID="mobile-app-header">
        {shouldShowEnvironmentBadge() ? <View style={styles.badgeBand} /> : null}
        <View style={styles.row}>
          <View style={styles.menuSlot}>
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => setDrawerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir le menu"
              testID="mobile-header-menu"
            >
              <Ionicons name="menu" size={HEADER_MENU_ICON_DP} color="#0F172A" />
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

          <View style={styles.actionsSlot}>
            {syncRoute ? (
              <HeaderAction
                icon="sync-outline"
                label="Synchroniser"
                testID="mobile-header-sync"
                onPress={() => openRootRoute(syncRoute)}
              />
            ) : null}
            {notificationsRoute ? (
              <HeaderAction
                icon="notifications-outline"
                label="Notifications"
                testID="mobile-header-notifications"
                count={canInternalNotifications ? internalUnread : 0}
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
  count = 0,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  testID: string;
  onPress: () => void;
  count?: number;
}) {
  const badgeLabel = count > 0 ? ` (${count} non lu${count > 1 ? "s" : ""})` : "";
  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${badgeLabel}`}
      testID={testID}
      activeOpacity={0.82}
    >
      <Ionicons name={icon} size={20} color="#334155" />
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
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
  badgeBand: {
    height: HEADER_BADGE_BAND_DP,
  },
  menuSlot: {
    width: HEADER_MENU_SLOT_DP,
    minHeight: COMPACT_HEADER_ROW_DP,
    flexDirection: "row",
    alignItems: "center",
  },
  menuButton: {
    width: HEADER_MENU_TOUCH_DP,
    height: HEADER_MENU_TOUCH_DP,
    minWidth: HEADER_MENU_TOUCH_DP,
    minHeight: HEADER_MENU_TOUCH_DP,
    alignItems: "center",
    justifyContent: "center",
  },
  context: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  schoolName: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "left",
    width: "100%",
  },
  actionsSlot: {
    width: HEADER_ACTIONS_SLOT_DP,
    minHeight: COMPACT_HEADER_ROW_DP,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  actionButton: {
    width: MIN_TOUCH_TARGET_DP,
    height: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
  },
});
