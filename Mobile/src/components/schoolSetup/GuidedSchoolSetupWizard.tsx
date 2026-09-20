import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { MIN_TOUCH_TARGET_DP } from "../../lib/mobileUsability";
import { schoolSetupGuidedApi, type GuidedSetupPayload } from "../../lib/schoolSetupGuidedApi";
import {
  GUIDED_MOBILE_LINKS,
  GUIDED_STEP_COPY,
  GUIDED_STEP_KEYS,
  guidedProgressLabel,
  guidedStepHeading,
} from "../../lib/schoolSetupGuidedMobile";

function progressBar(percent: number) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

export function GuidedSchoolSetupWizard({
  payload,
  onLeave,
  onCompleted,
  onFinish,
}: {
  payload: GuidedSetupPayload;
  onLeave?: () => void;
  onCompleted?: (next: GuidedSetupPayload) => void;
  onFinish?: () => void;
}) {
  const navigation = useNavigation<any>();
  const [current, setCurrent] = useState(payload);
  const [viewingStep, setViewingStep] = useState(payload.currentStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  usePreventRemove(false, () => undefined);

  useEffect(() => {
    setCurrent(payload);
    setViewingStep(payload.currentStep);
  }, [payload]);

  const stepMeta = current.steps.find((step) => step.index === viewingStep) ?? current.steps[0];
  const stepKey = (stepMeta?.key ?? GUIDED_STEP_KEYS[0]) as (typeof GUIDED_STEP_KEYS)[number];
  const copy = GUIDED_STEP_COPY[stepKey];
  const route = GUIDED_MOBILE_LINKS[stepKey];
  const isLast = viewingStep === 10;

  async function saveAndContinue() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await schoolSetupGuidedApi.completeStep(stepKey);
      setCurrent(next);
      setViewingStep(next.percent >= 100 ? 10 : next.currentStep);
      setSaved(true);
      onCompleted?.(next);
      return next;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible. Réessayez.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function finishSetup() {
    if (current.percent >= 100) {
      onFinish?.();
      return;
    }
    const next = await saveAndContinue();
    if (next?.percent >= 100) {
      onFinish?.();
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Configuration de votre établissement</Text>
      <View testID="guided-setup-progress" style={styles.progress}>
        <Text style={styles.heading} numberOfLines={1}>
          {guidedStepHeading(viewingStep) || `Étape ${viewingStep} sur 10`}
        </Text>
        <Text style={styles.percent} numberOfLines={1}>
          {guidedProgressLabel(current)}
        </Text>
        <Text style={styles.bar} numberOfLines={1}>
          {progressBar(current.percent)} {current.percent} %
        </Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.stepTitle}>{copy.title}</Text>
        <Text style={styles.stepBody}>{copy.description}</Text>
        <TouchableOpacity
          style={styles.link}
          onPress={() => navigation.navigate(route)}
          accessibilityRole="button"
          accessibilityLabel={copy.title}
        >
          <Text style={styles.linkText}>Ouvrir l'écran existant</Text>
        </TouchableOpacity>
        {saved ? <Text style={styles.ok}>Étape enregistrée.</Text> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}
      </ScrollView>
      <View testID="guided-setup-actions" style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.secondary]}
          disabled={viewingStep <= 1 || saving}
          onPress={() => setViewingStep((step) => Math.max(1, step - 1))}
          accessibilityRole="button"
          accessibilityLabel="Précédent"
        >
          <Text style={styles.secondaryText}>Précédent</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.tertiary]}
          onPress={() => onLeave?.()}
          accessibilityRole="button"
          accessibilityLabel="Quitter et reprendre plus tard"
        >
          <Text style={styles.tertiaryText} numberOfLines={2}>
            Quitter et reprendre plus tard
          </Text>
        </TouchableOpacity>
        {isLast ? (
          <>
            <TouchableOpacity
              style={[styles.btn, styles.secondary]}
              onPress={() => setViewingStep(1)}
              accessibilityRole="button"
              accessibilityLabel="Vérifier la configuration"
            >
              <Text style={styles.secondaryText}>Vérifier la configuration</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.primary]}
              disabled={saving}
              onPress={() => void finishSetup()}
              accessibilityRole="button"
              accessibilityLabel="Terminer la configuration"
            >
              <Text style={styles.primaryText}>{saving ? "Enregistrement…" : "Terminer la configuration"}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.btn, styles.primary]}
            disabled={saving}
            onPress={() => void saveAndContinue()}
            accessibilityRole="button"
            accessibilityLabel="Enregistrer et continuer"
          >
            <Text style={styles.primaryText}>{saving ? "Enregistrement…" : "Enregistrer et continuer"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 12 },
  title: { fontSize: 22, fontWeight: "800", color: "#111827", flexShrink: 1 },
  progress: { gap: 4, flexShrink: 0 },
  heading: { fontSize: 15, fontWeight: "700", color: "#111827", flexShrink: 1 },
  percent: { fontSize: 14, fontWeight: "600", color: "#475569", flexWrap: "wrap" },
  bar: { fontSize: 12, color: "#2563EB", fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { gap: 10, paddingBottom: 8 },
  stepTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  stepBody: { color: "#64748B", lineHeight: 20, fontWeight: "600" },
  link: { minHeight: MIN_TOUCH_TARGET_DP, justifyContent: "center" },
  linkText: { color: "#2563EB", fontWeight: "800" },
  ok: { color: "#0F766E", fontWeight: "700" },
  err: { color: "#B91C1C", fontWeight: "700" },
  actions: { gap: 8, flexShrink: 0 },
  btn: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primary: { backgroundColor: "#2563EB" },
  primaryText: { color: "#FFFFFF", fontWeight: "800" },
  secondary: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0" },
  secondaryText: { color: "#111827", fontWeight: "700" },
  tertiary: { backgroundColor: "transparent" },
  tertiaryText: { color: "#2563EB", fontWeight: "700", textAlign: "center" },
});
