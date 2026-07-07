import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { countUnreadAnnouncements, useAnnouncementsReadListener } from "../lib/announcementsRead";

type IconName = keyof typeof Ionicons.glyphMap;

function HeaderIconButton({
  icon,
  label,
  count = 0,
  onPress,
}: {
  icon: IconName;
  label: string;
  count?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      activeOpacity={0.85}
      style={styles.iconButton}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color="#475569" />
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/** Accès rapide Messages / Annonces / Notifications (aligné Topbar web). */
export default function CommunicationHeaderIcons({
  navigation,
  unreadMessages = 0,
}: {
  navigation: { navigate: (route: string) => void };
  unreadMessages?: number;
}) {
  const { session } = useAuth();
  const { notificationsData, announcementsData } = useAdminData();
  useAnnouncementsReadListener();

  const canMessages = canReadRoute(session, "Messages");
  const canAnnouncements = canReadRoute(session, "Announcements");
  const canNotifications = canReadView(session, "PlatformNotifications");

  if (!canMessages && !canAnnouncements && !canNotifications) {
    return null;
  }

  const unreadNotifications = notificationsData.filter(
    (item) => String(item.status ?? "") !== "Lu" && String(item.status ?? "") !== "read",
  ).length;
  const unreadAnnouncements = countUnreadAnnouncements(session?.user?.id, announcementsData);

  return (
    <View style={styles.row}>
      {canMessages ? (
        <HeaderIconButton
          icon="mail-outline"
          label="Messages"
          count={unreadMessages}
          onPress={() => navigation.navigate("Messages")}
        />
      ) : null}
      {canAnnouncements ? (
        <HeaderIconButton
          icon="megaphone-outline"
          label="Annonces"
          count={unreadAnnouncements}
          onPress={() => navigation.navigate("Announcements")}
        />
      ) : null}
      {canNotifications ? (
        <HeaderIconButton
          icon="notifications-outline"
          label="Notifications"
          count={unreadNotifications}
          onPress={() => navigation.navigate("PlatformNotifications")}
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
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
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
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
});
