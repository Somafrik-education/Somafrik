import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  COLLECTIVE_ROLL_CALL_COPY,
  addRollCallScan,
  createRollCallNfcLoop,
  rollCallProgress,
  rollCallScanFailure,
  undoLastRollCallScan,
  validateRollCallDraft,
  type RollCallDraft,
  type RollCallFeedback,
} from "../lib/studentCardRollCall";
import { releaseNfcSession, scanNfcCardToken, type NfcHardware } from "../lib/studentCardNfc";
import { createReactNativeNfcAdapter } from "../lib/studentCardNfcNative";
import { extractQrCapability, isQrBarcodeType } from "../lib/studentCardScan";
import { scanRollCallCard, validateRollCall } from "../services/studentCardRollCallApi";

const QR_REPEAT_COOLDOWN_MS = 3_000;

type Props = {
  visible: boolean;
  source: "nfc" | "qr";
  draft: RollCallDraft;
  className: string;
  rosterSize: number;
  teacherId?: string;
  hardware?: NfcHardware;
  onDraftChange: (draft: RollCallDraft) => void;
  onClose: () => void;
  onAbandon: () => void;
  onExpired: () => void;
  onValidated: (recorded: number) => void;
};

/** Fermeture complète du lecteur ; end() (Reader Mode RC-5) est utilisé dès qu'il est disponible. */
async function closeNfcReader(hardware: NfcHardware) {
  await releaseNfcSession(hardware);
  try {
    await (hardware as NfcHardware & { end?: () => Promise<void> }).end?.();
  } catch {
    // already released
  }
}

export default function StudentCardRollCallModal({
  visible,
  source,
  draft,
  className,
  rosterSize,
  teacherId,
  hardware,
  onDraftChange,
  onClose,
  onAbandon,
  onExpired,
  onValidated,
}: Props) {
  const [feedback, setFeedback] = useState<RollCallFeedback | null>(null);
  const [listening, setListening] = useState(false);
  const [validating, setValidating] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const hardwareRef = useRef<NfcHardware | null>(hardware ?? null);
  const draftRef = useRef(draft);
  const validatingRef = useRef(false);
  const submittingRef = useRef(false);
  const lastQrRef = useRef<{ value: string; at: number } | null>(null);
  const visibleRef = useRef(visible);
  draftRef.current = draft;
  visibleRef.current = visible;
  if (hardware) hardwareRef.current = hardware;

  const nfcHardware = useCallback(() => {
    hardwareRef.current ??= createReactNativeNfcAdapter();
    return hardwareRef.current;
  }, []);

  const submitToken = useCallback(async (cardToken: string): Promise<{ stop: boolean }> => {
    const current = draftRef.current;
    try {
      const scanned = await scanRollCallCard({
        sessionId: current.sessionId,
        classId: current.classId,
        date: current.date,
        cardToken,
      });
      // Session changée ou validée pendant la requête : ce scan n'appartient plus au brouillon.
      if (!visibleRef.current || draftRef.current.sessionId !== current.sessionId || validatingRef.current) {
        return { stop: false };
      }
      const next = addRollCallScan(draftRef.current, scanned);
      draftRef.current = next.draft;
      if (next.draft !== current) onDraftChange(next.draft);
      setFeedback(next.feedback);
      return { stop: false };
    } catch (error) {
      const failure = rollCallScanFailure(error);
      setFeedback(failure.feedback);
      return { stop: failure.stop };
    }
  }, [onDraftChange]);

  const submitTokenRef = useRef(submitToken);
  submitTokenRef.current = submitToken;
  const loopRef = useRef<ReturnType<typeof createRollCallNfcLoop> | null>(null);
  loopRef.current ??= createRollCallNfcLoop({
    read: () => scanNfcCardToken(nfcHardware()),
    submit: (token) => submitTokenRef.current(token),
    onFeedback: setFeedback,
    onListening: setListening,
  });

  const stopNfc = useCallback(async () => {
    loopRef.current?.stop();
    if (hardwareRef.current) await closeNfcReader(hardwareRef.current);
  }, []);

  const startNfc = useCallback(async () => {
    if (source !== "nfc" || validatingRef.current || !visibleRef.current) return;
    await stopNfc();
    if (!visibleRef.current) return;
    loopRef.current?.start();
  }, [source, stopNfc]);

  useEffect(() => {
    if (!visible) {
      void stopNfc();
      setFeedback(null);
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
    });
    return () => sub.remove();
  }, [stopNfc]);

  useEffect(() => {
    if (visible && source === "qr" && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission, source, visible]);

  const onBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (submittingRef.current || validatingRef.current || !isQrBarcodeType(result.type)) return;
    const value = extractQrCapability(result.data);
    if (!value) return;
    const now = Date.now();
    if (lastQrRef.current?.value === value && now - lastQrRef.current.at < QR_REPEAT_COOLDOWN_MS) return;
    lastQrRef.current = { value, at: now };
    submittingRef.current = true;
    void submitToken(value).finally(() => {
      submittingRef.current = false;
    });
  }, [submitToken]);

  const undoLast = useCallback(() => {
    if (validatingRef.current || draftRef.current.entries.length === 0) return;
    const next = undoLastRollCallScan(draftRef.current);
    draftRef.current = next;
    onDraftChange(next);
    setFeedback({ kind: "info", message: COLLECTIVE_ROLL_CALL_COPY.undone });
  }, [onDraftChange]);

  const validate = useCallback(async () => {
    if (validatingRef.current) return; // double soumission bloquée
    validatingRef.current = true;
    setValidating(true);
    await stopNfc();
    try {
      const outcome = await validateRollCallDraft(draftRef.current, { teacherId, validate: validateRollCall });
      if (outcome.kind === "validated") {
        onValidated(outcome.recorded);
        return;
      }
      if (outcome.kind === "expired") {
        setFeedback({ kind: "error", message: outcome.message });
        onExpired();
        return;
      }
      if (outcome.kind === "cards_invalid") {
        draftRef.current = outcome.draft;
        onDraftChange(outcome.draft);
      }
      setFeedback({ kind: "error", message: outcome.message });
    } finally {
      validatingRef.current = false;
      setValidating(false);
      if (visibleRef.current && source === "nfc") void startNfc();
    }
  }, [onDraftChange, onExpired, onValidated, source, startNfc, stopNfc, teacherId]);

  const close = useCallback(() => {
    if (validatingRef.current) return;
    void stopNfc();
    onClose();
  }, [onClose, stopNfc]);

  const abandon = useCallback(() => {
    if (validatingRef.current) return;
    Alert.alert(COLLECTIVE_ROLL_CALL_COPY.abandonConfirmTitle, COLLECTIVE_ROLL_CALL_COPY.abandonConfirmBody, [
      { text: COLLECTIVE_ROLL_CALL_COPY.keep, style: "cancel" },
      {
        text: COLLECTIVE_ROLL_CALL_COPY.abandonConfirm,
        style: "destructive",
        onPress: () => {
          void stopNfc();
          onAbandon();
        },
      },
    ]);
  }, [onAbandon, stopNfc]);

  const progress = rollCallProgress(draft, rosterSize);
  const feedbackStyle = feedback?.kind === "accepted"
    ? styles.feedbackAccepted
    : feedback?.kind === "duplicate" || feedback?.kind === "info"
      ? styles.feedbackNeutral
      : styles.feedbackRefused;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.className}>{className}</Text>
        <Text style={styles.title}>{COLLECTIVE_ROLL_CALL_COPY.title}</Text>

        <View style={styles.counterCard} testID="roll-call-counter">
          <Text style={styles.counter} accessibilityLiveRegion="polite">
            {progress.count} / {progress.total}
          </Text>
          <Text style={styles.counterLabel}>{COLLECTIVE_ROLL_CALL_COPY.counterLabel}</Text>
          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: progress.percent }}
          >
            <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
          </View>
          <Text style={styles.meta}>{COLLECTIVE_ROLL_CALL_COPY.remaining(progress.remaining)}</Text>
        </View>

        {source === "qr" ? (
          permission?.granted ? (
            <View style={styles.cameraWrap} testID="roll-call-camera">
              {visible && !validating ? (
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={onBarcodeScanned}
                />
              ) : null}
            </View>
          ) : (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void requestPermission()}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Autoriser la caméra</Text>
            </TouchableOpacity>
          )
        ) : null}

        <View style={styles.panel} testID="roll-call-status">
          {listening ? <ActivityIndicator color="#2563EB" /> : null}
          <Text style={styles.panelText}>
            {source === "nfc" ? COLLECTIVE_ROLL_CALL_COPY.instructionsNfc : COLLECTIVE_ROLL_CALL_COPY.instructionsQr}
          </Text>
          <Text style={styles.meta}>{COLLECTIVE_ROLL_CALL_COPY.privacy}</Text>
          {source === "nfc" && !listening && !validating ? (
            <TouchableOpacity
              testID="roll-call-restart-reader"
              style={styles.secondaryButton}
              onPress={() => void startNfc()}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Relancer la lecture</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {feedback ? (
          <Text testID="roll-call-feedback" style={[styles.feedback, feedbackStyle]} accessibilityLiveRegion="polite">
            {feedback.message}
          </Text>
        ) : null}

        <Text style={styles.draftNotice}>{COLLECTIVE_ROLL_CALL_COPY.draft}</Text>

        <TouchableOpacity
          testID="roll-call-undo"
          style={styles.secondaryButton}
          onPress={undoLast}
          disabled={validating || progress.count === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: validating || progress.count === 0 }}
        >
          <Text style={styles.secondaryText}>{COLLECTIVE_ROLL_CALL_COPY.undoLast}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="roll-call-validate"
          style={[styles.primaryButton, (validating || progress.count === 0) && styles.disabled]}
          onPress={() => void validate()}
          disabled={validating || progress.count === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: validating || progress.count === 0, busy: validating }}
        >
          {validating ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.primaryText}>
            {validating ? COLLECTIVE_ROLL_CALL_COPY.validating : COLLECTIVE_ROLL_CALL_COPY.validate(progress.count)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="roll-call-close"
          style={styles.secondaryButton}
          onPress={close}
          disabled={validating}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{COLLECTIVE_ROLL_CALL_COPY.close}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="roll-call-abandon"
          style={styles.dangerButton}
          onPress={abandon}
          disabled={validating}
          accessibilityRole="button"
        >
          <Text style={styles.dangerText}>{COLLECTIVE_ROLL_CALL_COPY.abandon}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20, paddingBottom: 40 },
  className: { color: "#2563EB", fontWeight: "900", fontSize: 16 },
  title: { marginTop: 4, fontSize: 26, fontWeight: "900", color: "#0F172A" },
  counterCard: { marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 20, alignItems: "center" },
  counter: { fontSize: 48, fontWeight: "900", color: "#0F172A" },
  counterLabel: { color: "#64748B", fontWeight: "800" },
  progressTrack: { marginTop: 14, height: 10, width: "100%", backgroundColor: "#E2E8F0", borderRadius: 999, overflow: "hidden" },
  progressFill: { height: 10, backgroundColor: "#16A34A", borderRadius: 999 },
  meta: { marginTop: 8, color: "#64748B", fontWeight: "700", textAlign: "center" },
  cameraWrap: { marginTop: 16, height: 260, borderRadius: 20, overflow: "hidden", backgroundColor: "#0F172A" },
  camera: { flex: 1 },
  panel: { marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 16 },
  panelText: { color: "#0F172A", fontWeight: "800", textAlign: "center" },
  feedback: { marginTop: 12, fontWeight: "900", textAlign: "center", padding: 10, borderRadius: 12 },
  feedbackAccepted: { color: "#166534", backgroundColor: "#DCFCE7" },
  feedbackNeutral: { color: "#334155", backgroundColor: "#F1F5F9" },
  feedbackRefused: { color: "#B45309", backgroundColor: "#FEF3C7" },
  draftNotice: { marginTop: 12, color: "#64748B", fontWeight: "700", textAlign: "center" },
  primaryButton: {
    marginTop: 12, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 16, backgroundColor: "#2563EB",
    alignItems: "center", justifyContent: "center", padding: 12, flexDirection: "row", gap: 8,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  disabled: { opacity: 0.5 },
  secondaryButton: {
    marginTop: 12, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center", padding: 12,
  },
  secondaryText: { color: "#334155", fontWeight: "900" },
  dangerButton: {
    marginTop: 12, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center", padding: 12, borderWidth: 1, borderColor: "#FCA5A5",
  },
  dangerText: { color: "#B91C1C", fontWeight: "900" },
});
