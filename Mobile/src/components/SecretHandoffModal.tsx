import { Share, StyleSheet, Text, TouchableOpacity } from "react-native";
import CanonicalMutationModal from "./CanonicalMutationModal";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

export type OneShotCredentials = {
  login: string;
  secret: string;
};

export default function SecretHandoffModal({
  visible,
  title,
  credentials,
  onAck,
}: {
  visible: boolean;
  title: string;
  credentials: OneShotCredentials | null;
  onAck: () => void;
}) {
  const login = credentials?.login ?? "";
  const secret = credentials?.secret ?? "";

  const share = () => {
    if (!login || !secret) return;
    void Share.share({
      message: `Identifiant : ${login}\nSecret temporaire : ${secret}`,
    });
  };

  return (
    <CanonicalMutationModal
      visible={visible}
      title={title}
      saving={false}
      submitLabel="J'ai noté"
      onClose={onAck}
      onSubmit={onAck}
    >
      <Text style={styles.warn}>
        Identifiants one-shot. Ils ne sont pas enregistrés sur l'appareil ni dans la file d'attente.
      </Text>
      <Text style={styles.label}>Identifiant</Text>
      <Text style={styles.value} selectable testID="secret-handoff-login">
        {login}
      </Text>
      <Text style={styles.label}>Secret temporaire</Text>
      <Text style={styles.value} selectable testID="secret-handoff-secret">
        {secret}
      </Text>
      <TouchableOpacity
        style={styles.copy}
        onPress={share}
        accessibilityRole="button"
        accessibilityLabel="Copier ou partager les identifiants"
        testID="secret-handoff-copy"
      >
        <Text style={styles.copyText}>Copier / partager</Text>
      </TouchableOpacity>
    </CanonicalMutationModal>
  );
}

const styles = StyleSheet.create({
  warn: { color: "#B45309", fontWeight: "800", marginBottom: 12, lineHeight: 20 },
  label: { color: "#64748B", fontWeight: "800", marginTop: 8 },
  value: {
    color: "#0F172A",
    fontWeight: "900",
    fontSize: 16,
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  copy: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  copyText: { color: "#0F172A", fontWeight: "900" },
});
