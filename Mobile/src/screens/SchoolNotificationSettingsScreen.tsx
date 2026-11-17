import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { useAdminData } from "../context/AdminDataContext";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_RECIPIENT_LABELS,
  notificationChannelOf,
  notificationPatchFromDisplayedRules,
  notificationRowsFromSettings,
  notificationSettingsWithToggle,
  notificationTogglePatch,
  type SchoolNotificationChannel,
  type SchoolNotificationEvent,
  type SchoolNotificationRecipient,
  type SchoolNotificationSettings,
} from "../lib/schoolNotificationSettingsMobile";
import { getSchoolNotificationSettings, patchSchoolNotificationSettings } from "../services/schoolSettingsApi";

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * AUDIT-SETUP-GUIDED-10-01 / A6 — Paramètres › Notifications (natif).
 * Parité Web `SettingsNotificationsPage` : lecture pour les opérateurs Paramètres,
 * écriture réservée à `Paramètres Établissement:UPDATE`, validation Backend.
 */
export default function SchoolNotificationSettingsScreen() {
  const { canOpen, canEdit, session } = useSchoolSettingsAccess("SchoolNotificationSettings");
  const { activeSchoolCode } = useAdminData();
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const schoolCode =
    (activeSchoolCode && activeSchoolCode !== "*" ? activeSchoolCode : "") ||
    String(session?.school?.code || session?.user?.schoolCode || "").trim();

  const [settings, setSettings] = useState<SchoolNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!canOpen || !schoolCode) {
        setSettings(null);
        setLoading(false);
        return undefined;
      }
      setLoading(true);
      setError("");
      void getSchoolNotificationSettings(schoolCode)
        .then((result) => {
          if (active) setSettings(result);
        })
        .catch((cause: unknown) => {
          if (active) {
            setSettings(null);
            setError(errorMessage(cause, "Impossible de charger les règles de notification."));
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [canOpen, schoolCode]),
  );

  const rows = useMemo(() => notificationRowsFromSettings(settings), [settings]);
  const unsaved = Boolean(settings) && settings?.configured === false;
  const busy = Boolean(savingKey) || loading;

  async function saveDisplayedRules() {
    if (!settings || !canEdit || busy) return;
    setSavingKey("all");
    setError("");
    try {
      setSettings(await patchSchoolNotificationSettings(schoolCode, notificationPatchFromDisplayedRules(settings)));
    } catch (cause) {
      setError(errorMessage(cause, "L'enregistrement des règles a été refusé."));
    } finally {
      setSavingKey("");
    }
  }

  async function toggle(
    event: SchoolNotificationEvent,
    recipient: SchoolNotificationRecipient,
    channel: SchoolNotificationChannel,
  ) {
    if (!settings || !canEdit || busy) return;
    const previous = settings;
    setSettings(notificationSettingsWithToggle(settings, event, recipient, channel));
    setSavingKey(`${event}:${recipient}:${channel}`);
    setError("");
    try {
      setSettings(await patchSchoolNotificationSettings(schoolCode, notificationTogglePatch(previous, event, recipient, channel)));
    } catch (cause) {
      setSettings(previous);
      setError(errorMessage(cause, "L'enregistrement a été refusé. L'interrupteur a été rétabli."));
    } finally {
      setSavingKey("");
    }
  }

  if (!canOpen) {
    return <SchoolSettingsDenied />;
  }

  return (
    <ScrollView
      style={styles.screen}
      testID="school-notification-settings"
      contentContainerStyle={{
        padding: horizontalPadding,
        paddingBottom: bottomPadding,
        maxWidth: contentMaxWidth,
        alignSelf: "center",
        width: "100%",
        gap: 12,
      }}
    >
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtitle}>
        Choisissez quels événements informent les familles, les élèves, les enseignants et l'administration, et par quels canaux.
      </Text>

      {!schoolCode ? <Text style={styles.muted}>Aucun établissement actif.</Text> : null}

      {error ? (
        <View style={styles.errorBox} testID="school-notification-settings-error" accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {unsaved ? (
        <View style={styles.infoBox} testID="school-notification-settings-unsaved">
          <Text style={styles.infoTitle}>Règles par défaut non enregistrées</Text>
          <Text style={styles.infoText}>
            Les règles ci-dessous sont les valeurs par défaut : aucune règle n'est encore enregistrée pour cet établissement.
            L'étape « Communication » de la configuration guidée exige au moins une règle enregistrée.
          </Text>
          {canEdit ? (
            <TouchableOpacity
              style={[styles.primary, busy && styles.disabled]}
              disabled={!canEdit || busy}
              onPress={() => void saveDisplayedRules()}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>{savingKey === "all" ? "Enregistrement…" : "Enregistrer ces règles"}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading && !settings ? <ActivityIndicator color="#2563EB" /> : null}

      {rows.map((row) => {
        const rule = settings?.events[row.event];
        return (
          <View key={row.id} style={styles.card}>
            <Text style={styles.cardTitle}>{NOTIFICATION_EVENT_LABELS[row.event]}</Text>
            <Text style={styles.cardSubtitle}>{NOTIFICATION_RECIPIENT_LABELS[row.recipient]}</Text>
            {NOTIFICATION_CHANNELS.map((channel) => {
              const label = `${NOTIFICATION_EVENT_LABELS[row.event]} — ${NOTIFICATION_RECIPIENT_LABELS[row.recipient]} — ${channel.label}`;
              return (
                <View key={channel.key} style={styles.switchRow}>
                  <Text style={styles.switchLabel}>{channel.label}</Text>
                  <Switch
                    value={notificationChannelOf(rule, row.recipient, channel.key)}
                    disabled={!canEdit || busy}
                    onValueChange={() => void toggle(row.event, row.recipient, channel.key)}
                    accessibilityLabel={label}
                  />
                </View>
              );
            })}
          </View>
        );
      })}

      {!canEdit && settings ? (
        <Text style={styles.muted}>
          Vous pouvez consulter ces règles. Seuls les administrateurs de l'établissement peuvent les modifier.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 22, fontWeight: "900", color: "#0F172A" },
  subtitle: { color: "#475569" },
  muted: { color: "#64748B" },
  errorBox: { borderRadius: 12, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", padding: 12 },
  errorText: { color: "#B91C1C", fontWeight: "700" },
  infoBox: { borderRadius: 12, backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#BFDBFE", padding: 12, gap: 8 },
  infoTitle: { color: "#1E3A8A", fontWeight: "800" },
  infoText: { color: "#1E3A8A" },
  primary: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 10,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "800" },
  disabled: { opacity: 0.6 },
  card: { borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", padding: 12, gap: 4 },
  cardTitle: { fontWeight: "800", color: "#0F172A" },
  cardSubtitle: { color: "#475569", marginBottom: 4 },
  switchRow: {
    minHeight: MIN_TOUCH_TARGET_DP,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: { color: "#0F172A" },
});
