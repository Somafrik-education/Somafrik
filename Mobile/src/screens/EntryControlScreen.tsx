import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import StudentCardEntryControlModal from "../components/StudentCardEntryControlModal";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { ENTRY_CONTROL_COPY, entryControlActor, entryControlMedia } from "../lib/studentCardEntryControl";

/**
 * CARTE-PR3-M1 — écran autonome du contrôle d'entrée, accessible avec la seule permission
 * Contrôle d'entrée (sans aucun droit Présences). Il ne lit ni présences, ni élèves, ni
 * capacités de pointage : le serveur résout tout à partir de la carte et refuse ce qui est interdit.
 */
export default function EntryControlScreen() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const allowed = entryControlActor(session);
  const media = entryControlMedia({ settings: null, platformOs: Platform.OS });
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">{ENTRY_CONTROL_COPY.title}</Text>
      <Text style={styles.subtitle}>{ENTRY_CONTROL_COPY.subtitle}</Text>
      {allowed ? (
        <TouchableOpacity
          testID="entry-control-start"
          style={styles.primaryButton}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={ENTRY_CONTROL_COPY.start}
          accessibilityHint={ENTRY_CONTROL_COPY.subtitle}
        >
          <Ionicons name="enter-outline" size={20} color="#FFFFFF" />
          <Text style={styles.primaryText}>{ENTRY_CONTROL_COPY.start}</Text>
        </TouchableOpacity>
      ) : (
        <Text testID="entry-control-denied" style={styles.denied}>{ENTRY_CONTROL_COPY.forbidden}</Text>
      )}
      {allowed ? <StudentCardEntryControlModal visible={open} media={media} onClose={() => setOpen(false)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, color: "#64748B", fontWeight: "700" },
  primaryButton: {
    marginTop: 20, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 16, backgroundColor: "#2563EB",
    alignItems: "center", justifyContent: "center", padding: 14, flexDirection: "row", gap: 8,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  denied: { marginTop: 16, color: "#B45309", fontWeight: "800" },
});
