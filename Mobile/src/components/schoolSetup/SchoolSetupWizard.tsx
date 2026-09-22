import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../../lib/mobileUsability";
import {
  dismissSchoolSetupWizardForSession,
  schoolSetupWizardSteps,
  type SchoolSetupWizardStep,
} from "../../lib/schoolSetupMobile";
import type { SchoolSetupPayload } from "../../lib/schoolSetupStatusApi";

export function SchoolSetupWizard({
  payload,
  onOpenStep,
  onLater,
}: {
  payload: SchoolSetupPayload;
  onOpenStep: (step: SchoolSetupWizardStep) => void;
  onLater?: () => void;
}) {
  const steps = schoolSetupWizardSteps(payload);

  function handleLater() {
    dismissSchoolSetupWizardForSession();
    onLater?.();
  }

  return (
    <View style={styles.card} testID="school-setup-wizard">
      <Text style={styles.title}>Assistant de configuration</Text>
      <Text style={styles.description}>
        Ces actions ouvrent les écrans existants. Aucun formulaire n'est dupliqué ici.
      </Text>
      {steps.map((step) =>
        step.disabled ? (
          <View key={step.id} style={styles.disabledRow}>
            <Text style={styles.stepLabel}>{step.label}</Text>
            <Text style={styles.disabledHint}>Étape précédente requise</Text>
          </View>
        ) : (
          <TouchableOpacity
            key={step.id}
            style={styles.stepRow}
            onPress={() => onOpenStep(step)}
            accessibilityRole="button"
            accessibilityLabel={step.label}
            testID={`school-setup-step-${step.id}`}
          >
            <Text style={styles.stepLabel}>{step.label}</Text>
            <Text style={styles.stepAction}>{step.done ? "Revoir →" : "Ouvrir →"}</Text>
          </TouchableOpacity>
        ),
      )}
      <TouchableOpacity
        style={styles.later}
        onPress={handleLater}
        accessibilityRole="button"
        accessibilityLabel="Plus tard"
        testID="school-setup-later"
      >
        <Text style={styles.laterText}>Plus tard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  description: { fontSize: 14, fontWeight: "500", color: "#64748B", lineHeight: 20 },
  stepRow: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  disabledRow: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepLabel: { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  stepAction: { fontSize: 13, fontWeight: "700", color: "#2563EB" },
  disabledHint: { fontSize: 12, fontWeight: "600", color: "#94A3B8" },
  later: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E2E8F0",
    marginTop: 4,
  },
  laterText: { color: "#0F172A", fontWeight: "800" },
});
