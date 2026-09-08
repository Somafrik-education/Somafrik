import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getCommunicationPreferences,
  updateCommunicationPreferences,
  type CommunicationChannel,
  type CommunicationChannels,
} from "../services/communicationPreferencesApi";

const CHANNELS: Array<{
  channel: CommunicationChannel;
  icon: string;
  label: string;
  description: string;
}> = [
  {
    channel: "IN_APP",
    icon: "🔔",
    label: "Notifications dans l’application",
    description: "Afficher les alertes Somafrik dans votre centre de notifications.",
  },
  {
    channel: "PUSH",
    icon: "📱",
    label: "Notifications push",
    description: "Recevoir les alertes Somafrik sur les appareils autorisés.",
  },
  {
    channel: "EMAIL",
    icon: "✉️",
    label: "E-mails",
    description: "Recevoir par e-mail les communications scolaires prévues pour ce canal.",
  },
];

export default function CommunicationPreferencesSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<CommunicationChannels | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<CommunicationChannel | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setError("");
    void getCommunicationPreferences()
      .then((result) => {
        if (active) setChannels(result.channels);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Impossible de charger vos préférences.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  async function toggle(channel: CommunicationChannel) {
    if (!channels || saving) return;
    const previous = channels;
    const nextValue = !channels[channel];
    setChannels({ ...channels, [channel]: nextValue });
    setSaving(channel);
    setError("");
    try {
      const result = await updateCommunicationPreferences({ [channel]: nextValue });
      setChannels(result.channels);
    } catch (cause) {
      setChannels(previous);
      setError(cause instanceof Error ? cause.message : "La préférence n’a pas pu être enregistrée.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>MON COMPTE</Text>
            <Text style={styles.title}>Préférences de communication</Text>
            <Text style={styles.subtitle}>Choisissez comment Somafrik vous informe pour cet établissement.</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            style={styles.closeButton}
            onPress={onClose}
          >
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {loading && !channels ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>Chargement des préférences…</Text>
            </View>
          ) : (
            <View style={styles.channelList}>
              {CHANNELS.map((item) => {
                const checked = channels?.[item.channel] ?? true;
                const disabled = !channels || Boolean(saving);
                return (
                  <View key={item.channel} style={styles.channelRow}>
                    <Text style={styles.channelIcon}>{item.icon}</Text>
                    <View style={styles.channelCopy}>
                      <Text style={styles.channelLabel}>{item.label}</Text>
                      <Text style={styles.channelDescription}>{item.description}</Text>
                    </View>
                    <Switch
                      value={checked}
                      disabled={disabled}
                      onValueChange={() => void toggle(item.channel)}
                      accessibilityLabel={item.label}
                      accessibilityHint={saving === item.channel ? "Enregistrement en cours" : undefined}
                    />
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.securityBox}>
            <Text style={styles.securityIcon}>🛡️</Text>
            <Text style={styles.securityText}>
              Les e-mails indispensables à la sécurité du compte, notamment la réinitialisation du mot de passe, restent envoyés même si le canal E-mails est désactivé.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  headerText: { flex: 1 },
  eyebrow: { color: "#2563EB", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  title: { marginTop: 4, color: "#0F172A", fontSize: 22, fontWeight: "900" },
  subtitle: { marginTop: 6, color: "#64748B", fontSize: 14, lineHeight: 20 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: "#475569", fontSize: 18, fontWeight: "800" },
  content: { padding: 20, paddingBottom: 36 },
  errorBox: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  errorText: { color: "#B91C1C", fontSize: 13, fontWeight: "700", lineHeight: 19 },
  loadingBox: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  loadingText: { color: "#64748B", fontSize: 14, fontWeight: "600" },
  channelList: { gap: 12 },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  channelIcon: { fontSize: 22 },
  channelCopy: { flex: 1, minWidth: 0 },
  channelLabel: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  channelDescription: { marginTop: 3, color: "#64748B", fontSize: 12, lineHeight: 18 },
  securityBox: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFBEB",
  },
  securityIcon: { fontSize: 20 },
  securityText: { flex: 1, color: "#78350F", fontSize: 12, lineHeight: 18 },
});
