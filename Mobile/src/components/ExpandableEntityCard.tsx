import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

type Tone = "default" | "warning" | "danger";

export type ExpandableEntityCardProps = {
  title: string;
  subtitle: string;
  badge: string;
  badgeTone?: Tone;
  badgeContent?: ReactNode;
  summaryActions?: ReactNode;
  children: ReactNode;
  testID?: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

export default function ExpandableEntityCard({
  title,
  subtitle,
  badge,
  badgeTone = "default",
  badgeContent,
  summaryActions,
  children,
  testID,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
}: ExpandableEntityCardProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const isControlled = expanded !== undefined;
  const isExpanded = isControlled ? Boolean(expanded) : uncontrolledExpanded;
  const badgeStyle =
    badgeTone === "danger"
      ? styles.badgeDanger
      : badgeTone === "warning"
        ? styles.badgeWarning
        : styles.badgeDefault;

  const toggle = () => {
    const next = !isExpanded;
    if (!isControlled) {
      setUncontrolledExpanded(next);
    }
    onExpandedChange?.(next);
  };

  return (
    <View style={styles.card} testID={testID}>
      <TouchableOpacity
        activeOpacity={0.82}
        style={styles.summary}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={`${title}, ${badge || subtitle}. ${isExpanded ? "Masquer" : "Afficher"} les détails`}
      >
        <View style={styles.identity}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {badgeContent ? (
          <View style={styles.badgeContent}>{badgeContent}</View>
        ) : badge ? (
          <Text style={[styles.badge, badgeStyle]} numberOfLines={1} adjustsFontSizeToFit>
            {badge}
          </Text>
        ) : null}
        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color="#64748B" />
      </TouchableOpacity>
      {summaryActions ? <View style={styles.summaryActions}>{summaryActions}</View> : null}
      {isExpanded ? <View style={styles.detail}>{children}</View> : null}
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
    minHeight: Math.max(68, MIN_TOUCH_TARGET_DP),
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
  summaryActions: {
    borderTopWidth: 1,
    borderTopColor: "#D9E1EC",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  detail: { borderTopWidth: 1, borderTopColor: "#D9E1EC", padding: 14 },
});
