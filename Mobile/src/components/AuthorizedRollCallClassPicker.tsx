/**
 * NFC-ROLES-ACCESS-01 — sélecteur autonome d'une classe autorisée à l'appel.
 * Ne navigue jamais vers la fiche de classe. La liste provient exclusivement de l'API d'autorisation
 * (pas du cache Élèves/Classes ni d'une permission de lecture de classe).
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { parseAuthorizedRollCallClasses, type AuthorizedRollCallClass } from "../lib/authorizedRollCallClasses";

type Props = {
  visible: boolean;
  /** Identité école/compte/environnement : invalide les réponses anciennes après changement de compte. */
  scopeKey: string;
  /** Réponse brute de l'API GET des classes sur lesquelles l'appel est autorisé. */
  loadAuthorizedClasses: () => Promise<unknown>;
  onSelect: (selected: AuthorizedRollCallClass) => void;
  onClose: () => void;
};

export default function AuthorizedRollCallClassPicker({
  visible, scopeKey, loadAuthorizedClasses, onSelect, onClose,
}: Props) {
  const [classes, setClasses] = useState<AuthorizedRollCallClass[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const generation = useRef(0);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  useEffect(() => {
    generation.current += 1;
    const ticket = generation.current;
    setClasses(null);
    setError(false);
    if (!visible || !scopeKey) return;
    void loadAuthorizedClasses().then((raw) => {
      if (ticket !== generation.current || scopeRef.current !== scopeKey) return;
      setClasses(parseAuthorizedRollCallClasses(raw));
    }).catch(() => {
      if (ticket !== generation.current || scopeRef.current !== scopeKey) return;
      setClasses([]);
      setError(true);
    });
    return () => { generation.current += 1; };
  }, [visible, scopeKey, loadAuthorizedClasses, refreshIndex]);

  const choose = (selected: AuthorizedRollCallClass) => {
    if (classes === null || error || scopeRef.current !== scopeKey) return;
    if (!classes.some((row) => row.classId === selected.classId)) return;
    onSelect(selected);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container} testID="nfc-direct-class-picker">
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Choisir la classe à appeler</Text>
          <TouchableOpacity testID="nfc-direct-class-cancel" onPress={onClose} accessibilityRole="button">
            <Text style={styles.action}>Fermer</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.description}>Seules les classes autorisées pour votre compte sont proposées.</Text>
        {classes === null && !error ? <ActivityIndicator testID="nfc-direct-class-loading" /> : null}
        {error ? (
          <View>
            <Text testID="nfc-direct-class-error">Impossible de vérifier vos classes autorisées. Aucun appel ne peut démarrer.</Text>
            <TouchableOpacity onPress={() => setRefreshIndex((n) => n + 1)} accessibilityRole="button">
              <Text style={styles.action}>Réessayer</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {classes?.length === 0 && !error ? <Text testID="nfc-direct-class-empty">Aucune classe autorisée.</Text> : null}
        <ScrollView>
          {!error && classes?.map((row) => (
            <TouchableOpacity
              key={row.classId}
              testID={`nfc-direct-class-${row.classId}`}
              style={styles.item}
              onPress={() => choose(row)}
              accessibilityRole="button"
              accessibilityLabel={`Démarrer l'appel de ${row.className}`}
            >
              <Text style={styles.itemTitle}>{row.className}</Text>
              {row.classCode ? <Text style={styles.itemCode}>{row.classCode}</Text> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#FFFFFF" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "700", flex: 1, color: "#0F172A" },
  description: { fontSize: 14, color: "#475569", marginBottom: 16 },
  action: { fontSize: 16, fontWeight: "600", color: "#2563EB", padding: 12 },
  item: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, padding: 16, marginBottom: 10, minHeight: 56 },
  itemTitle: { fontSize: 16, fontWeight: "600", color: "#0F172A" },
  itemCode: { fontSize: 13, color: "#64748B", marginTop: 4 },
});
