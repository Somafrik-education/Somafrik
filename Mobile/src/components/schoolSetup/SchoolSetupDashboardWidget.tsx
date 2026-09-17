import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../../lib/mobileUsability";
import { dashboardSetupProgressLabel } from "../../lib/schoolSetupMobile";
import type { SchoolSetupPayload } from "../../lib/schoolSetupStatusApi";

export function SchoolSetupDashboardWidget({
  payload,
  heading = "Configuration rapide",
  actionLabel = "Continuer",
  onContinue,
}: {
  payload: SchoolSetupPayload;
  heading?: string;
  actionLabel?: string;
  onContinue: () => void;
}) {
  return (
    <View style={styles.card} testID="school-setup-widget">
      <View style={styles.copy}>
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.progress}>Étapes essentielles : {dashboardSetupProgressLabel(payload)}</Text>
      </View>
      <TouchableOpacity
        style={styles.cta}
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        testID="school-setup-widget-continue"
      >
        <Text style={styles.ctaText}>{actionLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    gap: 12,
  },
  copy: { gap: 4 },
  title: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  progress: { fontSize: 14, fontWeight: "600", color: "#64748B" },
  cta: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  ctaText: { color: "#FFFFFF", fontWeight: "800" },
});
