import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

/** Erreur API globale sous les champs. Les erreurs locales vont dans FormField. */
type Props = {
  visible: boolean;
  title: string;
  error?: string;
  saving?: boolean;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  submitDisabled?: boolean;
};

export default function CanonicalMutationModal({
  visible,
  title,
  error,
  saving,
  submitLabel = "Enregistrer",
  onClose,
  onSubmit,
  children,
  submitDisabled,
}: Props) {
  const disabled = Boolean(saving || submitDisabled);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{title}</Text>
          {children}
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.secondary}
              onPress={onClose}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Annuler"
            >
              <Text style={styles.secondaryText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primary, disabled && styles.disabled]}
              onPress={onSubmit}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={submitLabel}
              accessibilityState={{ busy: saving, disabled }}
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{submitLabel}</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 18 },
  title: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 12 },
  error: { color: "#B91C1C", fontWeight: "800", marginTop: 8 },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  secondary: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: "#334155", fontWeight: "800" },
  primary: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  disabled: { opacity: 0.5 },
});
