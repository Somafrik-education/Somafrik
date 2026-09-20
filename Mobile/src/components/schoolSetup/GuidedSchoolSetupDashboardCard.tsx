import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../../lib/mobileUsability";
import type { GuidedSetupPayload } from "../../lib/schoolSetupGuidedApi";
import {
  guidedNextStepLabel,
  shouldShowGuidedSetupDashboardCard,
} from "../../lib/schoolSetupGuidedMobile";

export function GuidedSchoolSetupDashboardCard({
  payload,
  role,
  onResume,
}: {
  payload: GuidedSetupPayload;
  role?: string;
  onResume: () => void;
}) {
  if (!shouldShowGuidedSetupDashboardCard({ payload, role }) || payload.percent === 100) {
    return null;
  }
  const next = guidedNextStepLabel(payload) || payload.nextStepLabel || "la prochaine étape";
  return (
    <View style={styles.card} testID="guided-setup-dashboard-card">
      <Text style={styles.title}>Terminez la configuration de votre établissement</Text>
      <Text style={styles.body}>Votre établissement est configuré à {payload.percent} %.</Text>
      <Text style={styles.next}>Prochaine étape : {next}</Text>
      <TouchableOpacity
        style={styles.cta}
        onPress={onResume}
        accessibilityRole="button"
        accessibilityLabel="Reprendre la configuration"
      >
        <Text style={styles.ctaText}>Reprendre la configuration</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  title: { fontSize: 16, fontWeight: "800", color: "#111827" },
  body: { color: "#64748B", fontWeight: "600" },
  next: { color: "#111827", fontWeight: "700" },
  cta: {
    marginTop: 8,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#FFFFFF", fontWeight: "800" },
});
