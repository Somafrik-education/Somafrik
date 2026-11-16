import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  ENTRY_CONTROL_COPY,
  createEntryReadGate,
  describeEntryResult,
  submitEntryScan,
  type EntryPending,
  type EntryRead,
  type EntryView,
} from "../lib/studentCardEntryControl";
import { createRollCallNfcLoop, type RollCallFeedback } from "../lib/studentCardRollCall";
import { releaseNfcSession, scanNfcCardToken, type NfcHardware } from "../lib/studentCardNfc";
import { createReactNativeNfcAdapter } from "../lib/studentCardNfcNative";
import { extractQrCapability, isQrBarcodeType } from "../lib/studentCardScan";
import { recordEntryScan } from "../services/studentCardEntryApi";

const REPEAT_COOLDOWN_MS = 3_000;

type Props = {
  visible: boolean;
  media: { nfc: boolean; qr: boolean };
  hardware?: NfcHardware;
  onClose: () => void;
};

async function closeNfcReader(hardware: NfcHardware) {
  await releaseNfcSession(hardware);
  try {
    await (hardware as NfcHardware & { end?: () => Promise<void> }).end?.();
  } catch {
    // already released
  }
}

/**
 * CARTE-PR3-M1 — contrôle d'entrée : scan continu au portail, sans choix de classe.
 * Écrit seulement un passage au portail (entry-scan), jamais une présence en classe.
 */
export default function StudentCardEntryControlModal({ visible, media, hardware, onClose }: Props) {
  const [source, setSource] = useState<"nfc" | "qr">(media.nfc ? "nfc" : "qr");
  const [view, setView] = useState<EntryView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [counts, setCounts] = useState({ entered: 0, already: 0 });
  const [permission, requestPermission] = useCameraPermissions();
  const hardwareRef = useRef<NfcHardware | null>(hardware ?? null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const busyRef = useRef(false);
  // Reprise après perte réseau : même opération, gardée en mémoire seulement jusqu'au prochain scan.
  const pendingRef = useRef<EntryPending | null>(null);
  const gateRef = useRef(createEntryReadGate(REPEAT_COOLDOWN_MS));
  if (hardware) hardwareRef.current = hardware;

  const nfcHardware = useCallback(() => {
    hardwareRef.current ??= createReactNativeNfcAdapter();
    return hardwareRef.current;
  }, []);

  /** Une lecture à la fois ; renvoie stop=true quand le scan continu doit s'interrompre. */
  const submit = useCallback(async (read: EntryRead | EntryPending): Promise<{ stop: boolean }> => {
    if (busyRef.current || !visibleRef.current) return { stop: false };
    if (!("operationId" in read) && !gateRef.current.accept(read.cardToken, Date.now())) return { stop: false };
    busyRef.current = true;
    pendingRef.current = null;
    setCanRetry(false);
    setBusy(true);
    setMessage("");
    try {
      const outcome = await submitEntryScan(read, { scan: recordEntryScan });
      if (!visibleRef.current) return { stop: true };
      if (outcome.kind === "recorded") {
        setView(describeEntryResult(outcome.result));
        setCounts((current) => outcome.result.status === "entered"
          ? { ...current, entered: current.entered + 1 }
          : { ...current, already: current.already + 1 });
        return { stop: false };
      }
      setView(null);
      setMessage(outcome.failure.message);
      if (outcome.retry) {
        pendingRef.current = outcome.retry;
        setCanRetry(true);
      }
      return { stop: outcome.failure.stop || Boolean(outcome.retry) };
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const submitRef = useRef(submit);
  submitRef.current = submit;
  const loopRef = useRef<ReturnType<typeof createRollCallNfcLoop> | null>(null);
  loopRef.current ??= createRollCallNfcLoop({
    read: () => scanNfcCardToken(nfcHardware()),
    submit: (token) => submitRef.current({ cardToken: token, medium: "nfc" }),
    onFeedback: (feedback: RollCallFeedback) => setMessage(feedback.message),
    onListening: setListening,
  });

  const stopNfc = useCallback(async () => {
    loopRef.current?.stop();
    if (hardwareRef.current) await closeNfcReader(hardwareRef.current);
  }, []);

  const startNfc = useCallback(async () => {
    await stopNfc();
    if (!visibleRef.current) return;
    loopRef.current?.start();
  }, [stopNfc]);

  useEffect(() => {
    if (!visible) {
      void stopNfc();
      pendingRef.current = null;
      gateRef.current.reset();
      setView(null);
      setMessage("");
      setCanRetry(false);
      setCounts({ entered: 0, already: 0 });
      return;
    }
    if (source === "nfc") void startNfc();
    return () => {
      void stopNfc();
    };
  }, [source, startNfc, stopNfc, visible]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") void stopNfc();
      else if (visibleRef.current && source === "nfc" && !pendingRef.current) void startNfc();
    });
    return () => sub.remove();
  }, [source, startNfc, stopNfc]);

  useEffect(() => {
    if (visible && source === "qr" && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission, source, visible]);

  const onBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (busyRef.current || pendingRef.current || !isQrBarcodeType(result.type)) return;
    const value = extractQrCapability(result.data);
    if (!value) return;
    void submit({ cardToken: value, medium: "qr" });
  }, [submit]);

  const retry = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const { stop } = await submit(pending);
    if (!stop && source === "nfc") void startNfc();
  }, [source, startNfc, submit]);

  const switchSource = useCallback((next: "nfc" | "qr") => {
    pendingRef.current = null;
    setCanRetry(false);
    setMessage("");
    setSource(next);
  }, []);

  const close = useCallback(() => {
    void stopNfc();
    pendingRef.current = null;
    onClose();
  }, [onClose, stopNfc]);

  const showCamera = source === "qr" && permission?.granted && !canRetry;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">{ENTRY_CONTROL_COPY.title}</Text>
        <Text style={styles.subtitle}>{ENTRY_CONTROL_COPY.subtitle}</Text>

        {media.nfc && media.qr ? (
          <View style={styles.switchRow}>
            {(["nfc", "qr"] as const).map((option) => (
              <TouchableOpacity
                key={option}
                testID={`entry-control-source-${option}`}
                style={[styles.switchButton, source === option && styles.switchButtonActive]}
                onPress={() => switchSource(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected: source === option }}
              >
                <Text style={[styles.switchText, source === option && styles.switchTextActive]}>
                  {option === "nfc" ? ENTRY_CONTROL_COPY.useNfc : ENTRY_CONTROL_COPY.useQr}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Text style={styles.instructions}>
          {source === "nfc" ? ENTRY_CONTROL_COPY.instructionsNfc : ENTRY_CONTROL_COPY.instructionsQr}
        </Text>
        <Text testID="entry-control-counters" style={styles.counters}>
          {ENTRY_CONTROL_COPY.counters(counts.entered, counts.already)}
        </Text>

        {showCamera ? (
          <View style={styles.cameraWrap} testID="entry-control-camera">
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          </View>
        ) : null}

        {busy || (listening && source === "nfc") ? (
          <View style={styles.panel}>
            <ActivityIndicator color="#2563EB" />
            <Text style={styles.panelText}>{busy ? ENTRY_CONTROL_COPY.checking : ENTRY_CONTROL_COPY.listening}</Text>
          </View>
        ) : null}

        {view ? (
          <View
            testID="entry-control-result"
            accessibilityLiveRegion="polite"
            style={[styles.result, view.tone === "entered" ? styles.resultEntered : styles.resultAlready]}
          >
            <Text style={styles.headline}>{view.headline}</Text>
            {view.rows.map((row) => (
              <View key={`${row.label}-${row.value}`} style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={[styles.rowValue, row.label === "Situation financière" && view.financeAlert && styles.financeAlert]}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {message ? (
          <Text testID="entry-control-error" style={styles.error} accessibilityLiveRegion="polite">{message}</Text>
        ) : null}

        {canRetry ? (
          <TouchableOpacity
            testID="entry-control-retry"
            style={styles.primaryButton}
            onPress={() => void retry()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
          >
            <Text style={styles.primaryText}>{ENTRY_CONTROL_COPY.retry}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity testID="entry-control-close" style={styles.secondaryButton} onPress={close} accessibilityRole="button">
          <Text style={styles.secondaryText}>{ENTRY_CONTROL_COPY.close}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, color: "#64748B", fontWeight: "700" },
  switchRow: { flexDirection: "row", marginTop: 16, gap: 8 },
  switchButton: {
    flex: 1, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center", padding: 10,
  },
  switchButtonActive: { backgroundColor: "#2563EB" },
  switchText: { color: "#334155", fontWeight: "900" },
  switchTextActive: { color: "#FFFFFF" },
  instructions: { marginTop: 14, color: "#0F172A", fontWeight: "800" },
  counters: { marginTop: 6, color: "#475569", fontWeight: "800" },
  cameraWrap: { marginTop: 16, height: 260, borderRadius: 20, overflow: "hidden", backgroundColor: "#0F172A" },
  camera: { flex: 1 },
  panel: { marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 16, alignItems: "center" },
  panelText: { marginTop: 8, color: "#0F172A", fontWeight: "800" },
  result: { marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 16, borderWidth: 2 },
  resultEntered: { borderColor: "#86EFAC" },
  resultAlready: { borderColor: "#FCD34D" },
  headline: { fontSize: 20, fontWeight: "900", color: "#0F172A" },
  row: { marginTop: 10 },
  rowLabel: { color: "#64748B", fontWeight: "800" },
  rowValue: { color: "#0F172A", fontWeight: "900" },
  financeAlert: { color: "#B45309" },
  error: { marginTop: 12, color: "#B45309", fontWeight: "800" },
  primaryButton: {
    marginTop: 12, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 16, backgroundColor: "#2563EB",
    alignItems: "center", justifyContent: "center", padding: 12,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  secondaryButton: {
    marginTop: 12, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center", padding: 12,
  },
  secondaryText: { color: "#334155", fontWeight: "900" },
});
