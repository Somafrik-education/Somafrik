import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Tone = "default" | "warning" | "danger";

type Props = {
  title: string;
  subtitle: string;
  badge: string;
  badgeTone?: Tone;
  badgeContent?: ReactNode;
  children: ReactNode;
  testID?: string;
  defaultExpanded?: boolean;
};

export default function ExpandableFinanceCard({
  title,
  subtitle,
  badge,
  badgeTone = "default",
  badgeContent,
  children,
  testID,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const badgeStyle =
    badgeTone === "danger"
      ? styles.badgeDanger
      : badgeTone === "warning"
        ? styles.badgeWarning
        : styles.badgeDefault;

  return (
    <View style={styles.card} testID={testID}>
      <TouchableOpacity
        activeOpacity={0.82}
        style={styles.summary}
        onPress={() => setExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}, ${badge}. ${expanded ? "Masquer" : "Afficher"} les détails`}
      >
        <View style={styles.identity}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        {badgeContent ? (
          <View style={styles.badgeContent}>{badgeContent}</View>
        ) : (
          <Text style={[styles.badge, badgeStyle]} numberOfLines={1} adjustsFontSizeToFit>
            {badge}
          </Text>
        )}
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
    borderColor: "#D9E1EC",
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    marginBottom: 12,
  },
  summary: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  identity: { flex: 1, minWidth: 0 },
  title: { color: "#0F172A", fontSize: 16, fontWeight: "800" },
  subtitle: { color: "#64748B", fontSize: 13, fontWeight: "600", marginTop: 3 },
  badge: {
    maxWidth: "34%",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
    textAlignVertical: "center",
    textAlign: "center",
    fontSize: 12,
    fontWeight: "800",
  },
  badgeDefault: { color: "#1D4ED8", backgroundColor: "#EAF2FF" },
  badgeWarning: { color: "#A65B00", backgroundColor: "#FFF4D8" },
  badgeDanger: { color: "#B91C1C", backgroundColor: "#FDECEC" },
  badgeContent: { maxWidth: "36%" },
  detail: { borderTopWidth: 1, borderTopColor: "#D9E1EC", padding: 14 },
});
