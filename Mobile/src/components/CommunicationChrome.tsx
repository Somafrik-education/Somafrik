import { useNavigation } from "@react-navigation/native";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { canReadRoute } from "../domain/security/permissions";
import { canAccessMessagesRoute } from "../lib/mobileCtaRbacAlignment";
import { useAuth } from "../context/AuthContext";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  COM_FILTER_ALL,
  COM_FILTER_UNREAD,
  COM_MODULE_TITLE,
  COM_SEARCH_PLACEHOLDER,
  COM_SURFACE_ANNOUNCEMENTS,
  COM_SURFACE_MESSAGES,
  COM_SURFACE_NOTIFICATIONS,
} from "../lib/pariteCommunicationUxContract";

export type CommunicationSurface = "messages" | "announcements" | "notifications";

export default function CommunicationChrome({
  surface,
  title = COM_MODULE_TITLE,
  searchPlaceholder = COM_SEARCH_PLACEHOLDER,
  unreadLabel = COM_FILTER_UNREAD,
  countLabel,
  primaryAction,
  search,
  onSearch,
  unreadOnly,
  onUnreadOnly,
}: {
  surface: CommunicationSurface;
  title?: string;
  searchPlaceholder?: string;
  unreadLabel?: string;
  countLabel?: string;
  primaryAction?: React.ReactNode;
  search: string;
  onSearch: (value: string) => void;
  unreadOnly: boolean;
  onUnreadOnly: (value: boolean) => void;
}) {
  const navigation = useNavigation<any>();
  const { session } = useAuth();
  const canMessages = canAccessMessagesRoute(session);
  const canAnnouncements = canReadRoute(session, "Announcements");
  const canNotifications = canReadRoute(session, "InternalNotifications");

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <View style={styles.titles}>
          <Text style={styles.title}>{title}</Text>
          {countLabel ? <Text style={styles.count}>{countLabel}</Text> : null}
        </View>
        {primaryAction}
      </View>
      <View style={styles.subnav}>
        {canMessages ? (
          <NavChip
            label={COM_SURFACE_MESSAGES}
            active={surface === "messages"}
            onPress={() => navigation.navigate("Messages")}
          />
        ) : null}
        {canAnnouncements ? (
          <NavChip
            label={COM_SURFACE_ANNOUNCEMENTS}
            active={surface === "announcements"}
            onPress={() => navigation.navigate("Announcements")}
          />
        ) : null}
        {canNotifications ? (
          <NavChip
            label={COM_SURFACE_NOTIFICATIONS}
            active={surface === "notifications"}
            onPress={() => navigation.navigate("InternalNotifications")}
          />
        ) : null}
      </View>
      <TextInput
        value={search}
        onChangeText={onSearch}
        placeholder={searchPlaceholder}
        accessibilityLabel={searchPlaceholder}
        style={styles.search}
      />
      <View style={styles.filters}>
        <NavChip label={COM_FILTER_ALL} active={!unreadOnly} onPress={() => onUnreadOnly(false)} />
        <NavChip label={unreadLabel} active={unreadOnly} onPress={() => onUnreadOnly(true)} />
      </View>
    </View>
  );
}

function NavChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12, gap: 8 },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  titles: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, fontWeight: "800", color: "#0F172A" },
  count: { marginTop: 2, color: "#64748B", fontSize: 13, fontWeight: "600" },
  subnav: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  search: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#FFFFFF",
    color: "#0F172A",
  },
  chip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  chipText: { color: "#475569", fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: "#FFFFFF" },
});
