import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { GuidedSchoolSetupWizard } from "../components/schoolSetup/GuidedSchoolSetupWizard";
import { SchoolSetupOptionalCompleteness } from "../components/schoolSetup/SchoolSetupOptionalCompleteness";
import { SchoolSetupWizard } from "../components/schoolSetup/SchoolSetupWizard";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { dashboardSetupProgressLabel } from "../lib/schoolSetupMobile";
import { schoolSetupGuidedApi, type GuidedSetupPayload } from "../lib/schoolSetupGuidedApi";
import { schoolSetupStatusApi, type SchoolSetupPayload } from "../lib/schoolSetupStatusApi";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import { ApiClientError } from "../services/httpClient";

function schoolSetupStatusLabel(status: SchoolSetupPayload["status"]) {
  if (status === "READY") return "configuration essentielle terminée";
  if (status === "IN_PROGRESS") return "configuration en cours";
  return "configuration à démarrer";
}

export default function SchoolSetupSettingsScreen() {
  const navigation = useNavigation<any>();
  const { canOpen } = useSchoolSettingsAccess("Configuration");
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [payload, setPayload] = useState<SchoolSetupPayload | null>(null);
  const [guided, setGuided] = useState<GuidedSetupPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A7 : l'état de l'assistant guidé est explicite. Une erreur n'est jamais remplacée
  // silencieusement par l'ancien parcours 3/3.
  const [guidedState, setGuidedState] = useState<{ kind: "loading" | "ready" | "error"; message?: string }>({
    kind: "loading",
  });
  const [reloadKey, setReloadKey] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void schoolSetupStatusApi
        .get()
        .then((row) => {
          if (cancelled) return;
          setPayload(row);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPayload(null);
          setError(
            err instanceof ApiClientError ? err.message : "Impossible de charger le statut de configuration.",
          );
        });
      setGuidedState({ kind: "loading" });
      void schoolSetupGuidedApi
        .get()
        .then((row) => {
          if (cancelled) return;
          setGuided(row);
          setGuidedState({ kind: "ready" });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setGuided(null);
          const status = err instanceof ApiClientError && err.status ? ` (HTTP ${err.status})` : "";
          const detail = err instanceof Error && err.message ? ` : ${err.message}` : ".";
          setGuidedState({
            kind: "error",
            message: `Impossible de charger l'assistant de configuration${status}${detail}`,
          });
        });
      return () => {
        cancelled = true;
      };
    }, [reloadKey]),
  );

  if (!canOpen) {
    return <SchoolSettingsDenied />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        padding: horizontalPadding,
        paddingBottom: bottomPadding,
        maxWidth: contentMaxWidth,
        alignSelf: "center",
        width: "100%",
        gap: 16,
      }}
      testID="school-setup-settings"
    >
      <Text style={styles.title}>Configuration de l'établissement</Text>
      <Text style={styles.subtitle}>Suivez les étapes essentielles pour préparer votre établissement.</Text>
      {error ? (
        <View style={styles.alert}>
          <Text style={styles.alertText}>{error}</Text>
        </View>
      ) : null}
      {guidedState.kind === "error" ? (
        <View style={styles.alert} testID="guided-setup-load-error" accessibilityRole="alert">
          <Text style={styles.alertText}>{guidedState.message}</Text>
          {payload ? (
            <Text style={styles.alertText} testID="guided-setup-fallback-notice">
              En attendant, voici les 3 étapes essentielles (parcours simplifié) : l'assistant complet en 10 étapes n'a
              pas pu être chargé.
            </Text>
          ) : null}
          <TouchableOpacity
            style={styles.retry}
            onPress={() => setReloadKey((key) => key + 1)}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {(!payload && !error) || (guidedState.kind === "loading" && !guided) ? <ActivityIndicator color="#2563EB" /> : null}
      {guided ? (
        <GuidedSchoolSetupWizard
          payload={guided}
          onLeave={() => navigation.goBack()}
          onCompleted={setGuided}
          onFinish={() => navigation.navigate("Home")}
        />
      ) : payload ? (
        // A7 : l'ancien parcours 3/3 n'apparaît qu'après une erreur explicite de l'assistant guidé.
        guidedState.kind === "error" ? (
          <SchoolSetupWizard
            payload={payload}
            onOpenStep={(step) => navigation.navigate(step.to)}
            onLater={() => navigation.goBack()}
          />
        ) : null
      ) : null}
      {payload ? (
        <>
          <Text style={styles.meta}>
            Progression : {dashboardSetupProgressLabel(payload)} · {schoolSetupStatusLabel(payload.status)}
          </Text>
          <SchoolSetupOptionalCompleteness payload={payload} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", lineHeight: 20, fontWeight: "600" },
  meta: { fontSize: 14, fontWeight: "600", color: "#475569" },
  alert: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    padding: 12,
  },
  alertText: { color: "#B91C1C", fontWeight: "700" },
  retry: {
    marginTop: 8,
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#B91C1C",
  },
  retryText: { color: "#FFFFFF", fontWeight: "800" },
});
