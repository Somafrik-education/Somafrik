import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { statusPresentation } from "../lib/mobileUsability";

type Props = {
  status: string;
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
};

const TONES = {
  success: { color: "#0F766E", background: "#ECFDF5" },
  warning: { color: "#B45309", background: "#FFFBEB" },
  danger: { color: "#B91C1C", background: "#FEF2F2" },
  info: { color: "#1D4ED8", background: "#EFF6FF" },
  neutral: { color: "#334155", background: "#F1F5F9" },
} as const;

export default function StatusBadge({ status, tone }: Props) {
  const presented = statusPresentation(status);
  const palette = TONES[tone ?? inferTone(presented.label)];
  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]} accessibilityRole="text">
      <Ionicons name={presented.icon as never} size={14} color={palette.color} />
      <Text style={[styles.label, { color: palette.color }]}>{presented.label}</Text>
    </View>
  );
}

function inferTone(label: string): keyof typeof TONES {
  const normalized = label.toLowerCase();
  if (["payé", "paye", "présent", "present", "validée", "validee"].some((item) => normalized.includes(item))) {
    return "success";
  }
  if (["impay", "retard", "warning", "hors ligne", "file"].some((item) => normalized.includes(item))) {
    return "warning";
  }
  if (["absent", "annul", "erreur", "échec", "echec"].some((item) => normalized.includes(item))) {
    return "danger";
  }
  return "info";
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: "900",
  },
});
