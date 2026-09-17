import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { SchoolSetupWizard } from "../components/schoolSetup/SchoolSetupWizard";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { dashboardSetupProgressLabel } from "../lib/schoolSetupMobile";
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
  const [error, setError] = useState<string | null>(null);

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
      return () => {
        cancelled = true;
      };
    }, []),
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
      {!payload && !error ? <ActivityIndicator color="#2563EB" /> : null}
      {payload ? (
        <>
          <Text style={styles.meta}>
            Progression : {dashboardSetupProgressLabel(payload)} · {schoolSetupStatusLabel(payload.status)}
          </Text>
          <SchoolSetupWizard
            payload={payload}
            onOpenStep={(step) => navigation.navigate(step.to)}
            onLater={() => navigation.goBack()}
          />
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
});
