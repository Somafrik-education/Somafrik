import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { canDiagnoseNfc, visibleDiagnosisHolder, type DiagnosisResult } from "../lib/studentCardNfcDiagnosis";
import { createNfcDiagnosisReader } from "../lib/studentCardNfcDiagnosisNative";
import { diagnoseStudentNfcCard } from "../services/studentCardNfcDiagnosisApi";

type Row = { key: number; code: string; message: string; student?: string; klass?: string; physical: string };
/** R3-2 read-only field inventory: volatile local results, no UID/token storage or sharing. */
export default function StudentCardNfcDiagnosisScreen() {
  const { session } = useAuth();
  const permitted = canDiagnoseNfc(session);
  const readerRef = useRef<ReturnType<typeof createNfcDiagnosisReader> | null>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("Présentez une carte NTAG213/216. Deux lectures de la même carte seront demandées.");
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        generation.current++;
        void readerRef.current?.close();
        readerRef.current = null;
        setBusy(false);
      }
    });
    return () => {
      generation.current++;
      subscription.remove();
      void readerRef.current?.close();
      readerRef.current = null;
    };
  }, []);

  async function scan() {
    if (busy || !permitted || Platform.OS !== "android" || rows.length >= 8) return;
    const current = ++generation.current;
    const reader = createNfcDiagnosisReader();
    readerRef.current = reader;
    setBusy(true); setError("");
    setProgress("Lire l’UID puis retirer et représenter exactement la même carte pour lire NDEF.");
    try {
      const physical = await reader.inspect();
      if (current !== generation.current) return;
      setProgress("Interrogation sécurisée de l’établissement…");
      const result: DiagnosisResult = await diagnoseStudentNfcCard(physical);
      if (current !== generation.current) return;
      const holder = visibleDiagnosisHolder(result);
      // Intentionally never stores physical.uid, full NDEF, token, or any other school's PII.
      setRows(previous => previous.concat([{
        key: previous.length + 1, code: result.code, message: result.message,
        physical: result.physicalMessage,
        student: holder ? [holder.firstName, holder.lastName, holder.studentCode].filter(Boolean).join(" · ") : undefined,
        klass: holder?.className || holder?.classCode || undefined,
      }]).slice(0, 8));
      setProgress("Diagnostic terminé. Passez à la carte suivante.");
    } catch {
      if (current === generation.current) setError("Diagnostic non confirmé. Vérifiez le NFC, la carte et le réseau, puis réessayez. Aucune carte n’a été modifiée.");
    } finally {
      await reader.close().catch(() => undefined);
      if (readerRef.current === reader) readerRef.current = null;
      if (current === generation.current) setBusy(false);
    }
  }

  if (!permitted) return <View style={styles.page}><Text testID="nfc-diagnosis-denied">Diagnostic réservé à l’administrateur autorisé de l’établissement.</Text></View>;
  if (Platform.OS !== "android") return <View style={styles.page}><Text>Le diagnostic NFC R3 est disponible sur Android uniquement.</Text></View>;
  return <ScrollView testID="nfc-diagnosis-screen" style={styles.page} contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Diagnostic NFC — 8 cartes</Text>
    <Text style={styles.note}>Lecture seule · aucune écriture, réattribution, suppression ni déverrouillage. L’état physique est une déclaration Android, non une preuve serveur.</Text>
    <Text testID="nfc-diagnosis-counter" style={styles.counter}>{rows.length} / 8 cartes examinées</Text>
    <Text>{progress}</Text>
    {error ? <Text testID="nfc-diagnosis-error" style={styles.error}>{error}</Text> : null}
    <TouchableOpacity accessibilityRole="button" testID="nfc-diagnosis-scan" style={styles.button}
      disabled={busy || rows.length >= 8} onPress={() => void scan()}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonLabel}>{rows.length >= 8 ? "Inventaire terminé" : "Lire la carte suivante"}</Text>}
    </TouchableOpacity>
    {rows.map(row => <View key={row.key} testID="nfc-diagnosis-result" style={styles.result}>
      <Text style={styles.resultTitle}>Carte {row.key} · {row.code}</Text>
      <Text>{row.message}</Text><Text>{row.physical}</Text>
      {row.student ? <Text style={styles.owner}>Élève : {row.student}</Text> : null}
      {row.klass ? <Text>Classe : {row.klass}</Text> : null}
    </View>)}
    {rows.length ? <TouchableOpacity accessibilityRole="button" onPress={() => { generation.current++; void readerRef.current?.close(); setRows([]); setError(""); setProgress("Inventaire local effacé. Aucun état serveur n’a été modifié."); }}>
      <Text style={styles.reset}>Effacer les résultats locaux</Text>
    </TouchableOpacity> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F8FAFC" }, content: { padding: 20, gap: 16, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: "800", color: "#0F172A" },
  note: { color: "#475569" }, counter: { fontWeight: "800", fontSize: 18, color: "#1E40AF" },
  button: { backgroundColor: "#1D4ED8", minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  buttonLabel: { color: "#FFFFFF", fontWeight: "800" }, error: { color: "#B91C1C" },
  result: { backgroundColor: "#FFFFFF", padding: 14, borderRadius: 12, gap: 6, borderWidth: 1, borderColor: "#CBD5E1" },
  resultTitle: { fontWeight: "800", color: "#0F172A" }, owner: { fontWeight: "700" },
  reset: { textAlign: "center", color: "#1D4ED8", padding: 12 },
});
