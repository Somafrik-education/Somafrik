import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

type Tone = "default" | "info" | "danger";

type Props = {
  title: string;
  subtitle: string;
  badge: string;
  badgeTone?: Tone;
  children: ReactNode;
  testID?: string;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

export default function ExpandableCommunicationCard({
  title,
  subtitle,
  badge,
  badgeTone = "default",
  children,
  testID,
  defaultExpanded = false,
  onExpandedChange,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const badgeStyle =
    badgeTone === "danger" ? styles.badgeDanger : badgeTone === "info" ? styles.badgeInfo : styles.badgeDefault;

  function toggle() {
    setExpanded((current) => {
      const next = !current;
      onExpandedChange?.(next);
      return next;
    });
  }

  return (
    <View style={styles.card} testID={testID}>
      <TouchableOpacity
        activeOpacity={0.82}
        style={styles.summary}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}, ${badge}. ${expanded ? "Masquer" : "Afficher"} les détails`}
      >
        <View style={styles.identity}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.badge, badgeStyle]} numberOfLines={1}>
          {badge}
        </Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color="#64748B" />
      </TouchableOpacity>
      {expanded ? <View style={styles.detail}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 8,
  },
  summary: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  identity: { flex: 1, minWidth: 0 },
  title: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  subtitle: { color: "#64748B", fontSize: 12, fontWeight: "600", marginTop: 2 },
  badge: {
    maxWidth: "34%",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
  },
  badgeDefault: { color: "#475569", backgroundColor: "#E2E8F0" },
  badgeInfo: { color: "#1D4ED8", backgroundColor: "#DBEAFE" },
  badgeDanger: { color: "#B91C1C", backgroundColor: "#FDECEC" },
  detail: { borderTopWidth: 1, borderTopColor: "#E2E8F0", padding: 12, gap: 8 },
});
