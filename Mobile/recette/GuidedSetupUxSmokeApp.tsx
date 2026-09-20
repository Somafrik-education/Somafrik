/**
 * Recette runtime wizard guidé Mobile — vrais composants RN.
 * Jamais chargé en production (entrée Metro SOMAFRIK_GUIDED_SETUP_UX_SMOKE_ENTRY=1).
 */
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GuidedSchoolSetupWizard } from "../src/components/schoolSetup/GuidedSchoolSetupWizard";
import { schoolSetupGuidedApi, type GuidedSetupPayload } from "../src/lib/schoolSetupGuidedApi";
import { GUIDED_STEP_KEYS } from "../src/lib/schoolSetupGuidedMobile";

const LABELS: Record<string, string> = {
  establishment: "Informations établissement",
  academicYear: "Année scolaire",
  structure: "Structure pédagogique",
  subjects: "Matières",
  teachers: "Enseignants",
  students: "Élèves",
  finance: "Finance",
  pedagogy: "Paramètres pédagogiques",
  communication: "Communication",
  users: "Utilisateurs et droits",
};

function payloadAt(percent: number): GuidedSetupPayload {
  const completedCount = Math.max(0, Math.min(10, Math.round(percent / 10)));
  const completedSteps = GUIDED_STEP_KEYS.slice(0, completedCount);
  const currentStep = percent >= 100 ? 10 : Math.min(10, completedCount + 1);
  const nextKey = percent >= 100 ? null : GUIDED_STEP_KEYS[currentStep - 1];
  return {
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    status: percent >= 60 ? "operational" : "configuration_required",
    percent,
    currentStep,
    lastValidStep: completedCount,
    nextStepKey: nextKey,
    nextStepLabel: nextKey ? LABELS[nextKey] : null,
    completedSteps,
    steps: GUIDED_STEP_KEYS.map((key, index) => ({
      key,
      index: index + 1,
      label: LABELS[key],
      done: index < completedCount,
      unlocked: index <= completedCount,
    })),
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

const Stack = createNativeStackNavigator();

function HomeScreen() {
  return (
    <View style={styles.home} testID="guided-setup-home">
      <Text style={styles.homeTitle}>Accueil</Text>
      <Text style={styles.homeMeta}>Configuration terminée — retour au tableau de bord</Text>
    </View>
  );
}

function WizardScreen({ navigation }: { navigation: { navigate: (name: string) => void } }) {
  const [percent, setPercent] = useState(0);
  const payload = useMemo(() => payloadAt(percent), [percent]);

  schoolSetupGuidedApi.completeStep = async () => {
    const next = Math.min(100, percent + 10);
    setPercent(next);
    return payloadAt(next);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="guided-setup-smoke">
      <Text style={styles.kicker}>Recette Expo web — assistant guidé réel</Text>
      <View style={styles.row} testID="guided-setup-checkpoints">
        {[0, 10, 40, 50, 60, 100].map((value) => (
          <Pressable
            key={value}
            testID={`guided-setup-resume-${value}`}
            style={styles.chip}
            onPress={() => setPercent(value)}
          >
            <Text style={styles.chipText}>Reprendre {value} %</Text>
          </Pressable>
        ))}
      </View>
      <Text testID="guided-setup-status" style={styles.status}>
        statut={payload.status} · percent={payload.percent} · étape={payload.currentStep}
      </Text>
      <GuidedSchoolSetupWizard
        payload={payload}
        onLeave={() => navigation.navigate("Home")}
        onCompleted={(next) => setPercent(next.percent)}
        onFinish={() => navigation.navigate("Home")}
      />
    </ScrollView>
  );
}

export default function GuidedSetupUxSmokeApp() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="GuidedProof">
        <Stack.Screen name="GuidedProof" component={WizardScreen} options={{ title: "Configuration" }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Accueil" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  kicker: { fontSize: 12, fontWeight: "800", color: "#64748B", textTransform: "uppercase" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  chipText: { fontWeight: "700", color: "#111827" },
  status: { fontSize: 13, fontWeight: "700", color: "#334155" },
  home: { flex: 1, padding: 24, backgroundColor: "#F4F7FB", gap: 8 },
  homeTitle: { fontSize: 28, fontWeight: "800", color: "#111827" },
  homeMeta: { color: "#64748B", fontWeight: "600" },
});
