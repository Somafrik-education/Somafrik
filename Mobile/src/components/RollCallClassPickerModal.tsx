/**
 * NFC-ROLES-ACCESS-01 — choix de la classe pour « Démarrer l'appel NFC/QR », sans ouvrir la fiche
 * d'une classe. La liste vient du serveur (GET …/roll-call/offline/v1/classes, même contrat que le
 * pack et la synchronisation) : classes affectées pour un enseignant, classes de l'établissement
 * pour un rôle autorisé. Aucune donnée d'élève n'est affichée ni demandée.
 *
 * Hors connexion : dernière liste obtenue pour CE compte et CET établissement (mémoire du
 * processus, jamais persistée), clairement signalée. Le serveur revérifie tout au pack et à la sync.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { listOfflineRollCallClasses, type RollCallClassOption } from "../services/rollCallOfflineApi";

export const ROLL_CALL_PICKER_COPY = {
  title: "Choisir la classe de l'appel",
  hint: "Seules les classes sur lesquelles vous pouvez faire l'appel sont proposées.",
  loading: "Chargement des classes…",
  empty: "Aucune classe ne vous est ouverte pour l'appel.",
  offlineCached: "Hors connexion : dernière liste connue. Le serveur vérifiera vos droits à la synchronisation.",
  failed: "Liste des classes indisponible. Vérifiez la connexion puis réessayez.",
  retry: "Réessayer",
  close: "Fermer",
  enrolled: (count: number) => `${count} élève(s)`,
} as const;

/** Dernière liste par compte + établissement (jamais partagée entre comptes). */
const lastLists = new Map<string, RollCallClassOption[]>();

type Props = {
  visible: boolean;
  /** Clé de portée du compte connecté (environnement | établissement | compte). */
  scopeKey: string;
  onSelect: (target: { classId: string; className: string }) => void;
  onClose: () => void;
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; classes: RollCallClassOption[]; cached: boolean }
  | { kind: "error" };

export default function RollCallClassPickerModal({ visible, scopeKey, onSelect, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setState({ kind: "loading" });
    void listOfflineRollCallClasses()
      .then((result) => {
        if (cancelled) return;
        lastLists.set(scopeKey, result.classes);
        setState({ kind: "ready", classes: result.classes, cached: false });
      })
      .catch(() => {
        if (cancelled) return;
        const cached = scopeKey ? lastLists.get(scopeKey) : undefined;
        setState(cached ? { kind: "ready", classes: cached, cached: true } : { kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [reload, scopeKey, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={styles.container} testID="roll-call-class-picker">
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">{ROLL_CALL_PICKER_COPY.title}</Text>
          <TouchableOpacity testID="roll-call-class-picker-close" onPress={onClose} accessibilityRole="button" accessibilityLabel={ROLL_CALL_PICKER_COPY.close}>
            <Ionicons name="close" size={24} color="#0F172A" />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>{ROLL_CALL_PICKER_COPY.hint}</Text>
        {state.kind === "loading" ? (
          <View style={styles.center}>
            <ActivityIndicator color="#2563EB" />
            <Text style={styles.hint}>{ROLL_CALL_PICKER_COPY.loading}</Text>
          </View>
        ) : null}
        {state.kind === "error" ? (
          <View style={styles.center}>
            <Text style={styles.error} testID="roll-call-class-picker-error">{ROLL_CALL_PICKER_COPY.failed}</Text>
            <TouchableOpacity style={styles.retry} onPress={() => setReload((value) => value + 1)} accessibilityRole="button">
              <Text style={styles.retryText}>{ROLL_CALL_PICKER_COPY.retry}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {state.kind === "ready" ? (
          <ScrollView>
            {state.cached ? <Text style={styles.warn} testID="roll-call-class-picker-cached">{ROLL_CALL_PICKER_COPY.offlineCached}</Text> : null}
            {state.classes.length === 0 ? <Text style={styles.hint} testID="roll-call-class-picker-empty">{ROLL_CALL_PICKER_COPY.empty}</Text> : null}
            {state.classes.map((option) => (
              <TouchableOpacity
                key={option.classId}
                testID={`roll-call-class-${option.classId}`}
                style={styles.row}
                onPress={() => onSelect({ classId: option.classId, className: option.className })}
                accessibilityRole="button"
                accessibilityLabel={`Faire l'appel de ${option.className}`}
              >
                <Text style={styles.rowTitle}>{option.className}</Text>
                <Text style={styles.rowMeta}>{ROLL_CALL_PICKER_COPY.enrolled(option.enrolled)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: "#F8FAFC" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", color: "#0F172A", flex: 1 },
  hint: { fontSize: 14, color: "#475569", marginBottom: 12 },
  center: { alignItems: "center", gap: 8, paddingVertical: 24 },
  error: { fontSize: 14, color: "#991B1B", textAlign: "center" },
  warn: { fontSize: 13, color: "#92400E", backgroundColor: "#FEF3C7", padding: 10, borderRadius: 8, marginBottom: 10, overflow: "hidden" },
  retry: { backgroundColor: "#2563EB", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: MIN_TOUCH_TARGET_DP, justifyContent: "center" },
  retryText: { color: "#FFFFFF", fontWeight: "700" },
  row: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, marginBottom: 8, minHeight: MIN_TOUCH_TARGET_DP, borderWidth: 1, borderColor: "#E5E7EB" },
  rowTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  rowMeta: { fontSize: 13, color: "#64748B", marginTop: 2 },
});
