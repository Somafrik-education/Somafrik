import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canReadRoute } from "../domain/security/permissions";
import { canAccessMessagesRoute } from "../lib/mobileCtaRbacAlignment";
import { resolveNotificationsInboxRoute } from "../lib/notificationInboxRoute";
import { useAnnouncementsUnreadCount } from "../lib/announcementsRead";
import { useInternalNotificationsUnreadCount } from "../lib/internalNotificationsRead";
import { useMessagesUnreadCount } from "../lib/messagesRead";
import { ICON_HIT_SLOP, MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { HEADER_COMPACT_ACTION_DP } from "../lib/mobileUxV1Layout";

type IconName = keyof typeof Ionicons.glyphMap;

const HEADER_ICON_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

function HeaderIconButton({
  icon,
  label,
  count = 0,
  onPress,
  testID,
  compact = false,
}: {
  icon: IconName;
  label: string;
  count?: number;
  onPress: () => void;
  testID?: string;
  compact?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityHint={`Ouvrir ${label}`}
      hitSlop={compact ? HEADER_ICON_HIT_SLOP : ICON_HIT_SLOP}
      activeOpacity={0.85}
      style={compact ? styles.headerIconButton : styles.iconButton}
      onPress={onPress}
      testID={testID}
    >
      <Ionicons name={icon} size={compact ? 18 : 22} color={compact ? "#334155" : "#475569"} />
      {count > 0 ? (
        <View style={compact ? styles.headerBadge : styles.badge}>
          <Text style={compact ? styles.headerBadgeText : styles.badgeText}>
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/** Accès rapide Messages / Annonces / Notifications établissement (aligné Topbar web). */
export default function CommunicationHeaderIcons({
  navigation,
  unreadMessages,
  variant = "page",
}: {
  navigation: { navigate: (route: string) => void };
  unreadMessages?: number;
  variant?: "page" | "header";
}) {
  const compact = variant === "header";
  const { session } = useAuth();
  const { activeSchoolCode } = useAdminData();
  const canMessages = canAccessMessagesRoute(session);
  const canAnnouncements = canReadRoute(session, "Announcements");
  const { count: polledMessages } = useMessagesUnreadCount(canMessages, activeSchoolCode);
  const unreadAnnouncements = useAnnouncementsUnreadCount(canAnnouncements, activeSchoolCode);

  const resolvedNotificationsInboxRoute = resolveNotificationsInboxRoute(session, activeSchoolCode);
  const notificationsInboxRoute =
    resolvedNotificationsInboxRoute === "InternalNotifications"
      ? resolvedNotificationsInboxRoute
      : null;
  const canInternalNotifications = notificationsInboxRoute === "InternalNotifications";
  const { count: internalUnreadNotifications } = useInternalNotificationsUnreadCount(
    canInternalNotifications,
    activeSchoolCode,
  );
  const canNotifications = canInternalNotifications;
  const messagesCount = unreadMessages ?? polledMessages;

  if (!canMessages && !canAnnouncements && !canNotifications) {
    return null;
  }

  return (
    <View style={compact ? styles.headerRow : styles.row}>
      {canMessages ? (
        <HeaderIconButton
          icon="mail-outline"
          label="Messages"
          count={messagesCount}
          compact={compact}
          testID={compact ? "mobile-header-messages" : undefined}
          onPress={() => navigation.navigate("Messages")}
        />
      ) : null}
      {canAnnouncements ? (
        <HeaderIconButton
          icon="megaphone-outline"
          label="Annonces"
          count={unreadAnnouncements}
          compact={compact}
          testID={compact ? "mobile-header-announcements" : undefined}
          onPress={() => navigation.navigate("Announcements")}
        />
      ) : null}
      {canNotifications ? (
        <HeaderIconButton
          icon="notifications-outline"
          label="Notifications"
          count={internalUnreadNotifications}
          compact={compact}
          testID={compact ? "mobile-header-notifications" : undefined}
          onPress={() => navigation.navigate(notificationsInboxRoute ?? "InternalNotifications")}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  iconButton: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    width: MIN_TOUCH_TARGET_DP,
    height: MIN_TOUCH_TARGET_DP,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  headerIconButton: {
    width: HEADER_COMPACT_ACTION_DP,
    height: HEADER_COMPACT_ACTION_DP,
    minWidth: HEADER_COMPACT_ACTION_DP,
    minHeight: HEADER_COMPACT_ACTION_DP,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  headerBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  headerBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "800",
  },
});
