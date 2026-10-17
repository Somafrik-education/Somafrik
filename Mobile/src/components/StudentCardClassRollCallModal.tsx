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
  CLASS_ROLL_CALL_COPY,
  EDITABLE_STATUSES,
  STATUS_LABELS,
  applyRollCallScan,
  classRollCallCanSubmit,
  classRollCallCounts,
  classRollCallScanFailure,
  createClassRollCall,
  isLockedStudent,
  markAllPresent,
  mergeReloadedRoster,
  parseRollCallRoster,
  setStudentStatus,
  studentDisplayName,
  validateClassRollCall,
  type AttendanceStatus,
  type ClassRollCallDraft,
  type ClassRollCallFeedback,
  type EditableStatus,
} from "../lib/studentCardClassRollCall";
import { createRollCallNfcLoop } from "../lib/studentCardRollCall";
import { releaseNfcSession, scanNfcCardToken, type NfcHardware } from "../lib/studentCardNfc";
import { createReactNativeNfcAdapter } from "../lib/studentCardNfcNative";
import { extractQrCapability, isQrBarcodeType } from "../lib/studentCardScan";
import {
  getClassRollCallRoster,
  scanRollCallCard,
  validateCompleteClassRollCall,
} from "../services/studentCardRollCallApi";

const QR_REPEAT_COOLDOWN_MS = 3_000;

type Props = {
  visible: boolean;
  context: { scopeKey: string; sessionId: string; classId: string; date: string };
  className: string;
  draft: ClassRollCallDraft | null;
  nfcAvailable: boolean;
  qrAvailable: boolean;
  hardware?: NfcHardware;
  onDraftChange: (draft: ClassRollCallDraft) => void;
  onClose: () => void;
  onAbandon: () => void;
  onValidated: (message: string) => void;
};

async function closeNfcReader(hardware: NfcHardware) {
  await releaseNfcSession(hardware);
  try {
    await (hardware as NfcHardware & { end?: () => Promise<void> }).end?.();
  } catch {
    // déjà libéré
  }
}

const STATUS_COLORS: Record<AttendanceStatus, { bg: string; fg: string }> = {
  present: { bg: "#DCFCE7", fg: "#166534" },
  late: { bg: "#FEF3C7", fg: "#92400E" },
  absent: { bg: "#FEE2E2", fg: "#991B1B" },
  excused: { bg: "#E0E7FF", fg: "#3730A3" },
};

export default function StudentCardClassRollCallModal({
  visible,
  context,
  className,
  draft,
  nfcAvailable,
  qrAvailable,
  hardware,
  onDraftChange,
  onClose,
  onAbandon,
  onValidated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ClassRollCallFeedback | null>(null);
  const [scanSource, setScanSource] = useState<"nfc" | "qr" | null>(null);
  const [listening, setListening] = useState(false);
  const [validating, setValidating] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const draftRef = useRef(draft);
  const visibleRef = useRef(visible);
  const validatingRef = useRef(false);
  const submittingRef = useRef(false);
  const lastQrRef = useRef<{ value: string; at: number } | null>(null);
  const hardwareRef = useRef<NfcHardware | null>(hardware ?? null);
  draftRef.current = draft;
  visibleRef.current = visible;
  if (hardware) hardwareRef.current = hardware;

  const commit = useCallback((next: ClassRollCallDraft) => {
    draftRef.current = next;
    onDraftChange(next);
  }, [onDraftChange]);

  const loadRoster = useCallback(async (mode: "open" | "reload") => {
    setLoading(true);
    setLoadError(null);
    try {
      const students = parseRollCallRoster(await getClassRollCallRoster(context));
      if (!students) throw new Error("roster");
      const current = draftRef.current;
      commit(mode === "reload" && current ? mergeReloadedRoster(current, students) : createClassRollCall(context, students));
    } catch (error) {
      const failure = classRollCallScanFailure(error).feedback;
      setLoadError(failure.message === CLASS_ROLL_CALL_COPY.forbidden || failure.message === CLASS_ROLL_CALL_COPY.offline
        ? failure.message
        : CLASS_ROLL_CALL_COPY.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [commit, context]);

  useEffect(() => {
    if (visible && !draftRef.current && !loading) void loadRoster("open");
    // Chargement à l'ouverture uniquement : aucune écriture côté serveur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, context.sessionId]);

  const nfcHardware = useCallback(() => {
    hardwareRef.current ??= createReactNativeNfcAdapter();
    return hardwareRef.current;
  }, []);

  const submitToken = useCallback(async (cardToken: string): Promise<{ stop: boolean }> => {
    const current = draftRef.current;
    if (!current) return { stop: true };
    try {
      const scanned = await scanRollCallCard({
        sessionId: current.sessionId,
        classId: current.classId,
        date: current.date,
        mode: "teacher",
        cardToken,
      });
      if (!visibleRef.current || validatingRef.current || draftRef.current?.sessionId !== current.sessionId) {
        return { stop: false };
      }
      const next = applyRollCallScan(draftRef.current, scanned);
      if (next.draft !== draftRef.current) commit(next.draft);
      setFeedback(next.feedback);
      return { stop: false };
    } catch (error) {
      const failure = classRollCallScanFailure(error);
      setFeedback(failure.feedback);
      return { stop: failure.stop };
    }
  }, [commit]);

  const submitTokenRef = useRef(submitToken);
  submitTokenRef.current = submitToken;
  const loopRef = useRef<ReturnType<typeof createRollCallNfcLoop> | null>(null);
  loopRef.current ??= createRollCallNfcLoop({
    read: () => scanNfcCardToken(nfcHardware()),
    submit: (token) => submitTokenRef.current(token),
    onFeedback: (value) => setFeedback(value),
    onListening: setListening,
  });

  const stopNfc = useCallback(async () => {
    loopRef.current?.stop();
    if (hardwareRef.current) await closeNfcReader(hardwareRef.current);
  }, []);

  const stopScan = useCallback(async () => {
    setScanSource(null);
    await stopNfc();
  }, [stopNfc]);

  const startScan = useCallback(async (source: "nfc" | "qr") => {
    if (validatingRef.current || !draftRef.current) return;
    await stopNfc();
    setScanSource(source);
    if (source === "nfc") loopRef.current?.start();
    else if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission, stopNfc]);

  useEffect(() => {
    if (!visible) {
      void stopScan();
      setFeedback(null);
    }
  }, [stopScan, visible]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") void stopScan();
    });
    return () => {
      sub.remove();
      void stopNfc();
    };
  }, [stopNfc, stopScan]);

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

  const choose = useCallback((studentId: string, status: EditableStatus) => {
    if (validatingRef.current || !draftRef.current) return;
    const next = setStudentStatus(draftRef.current, studentId, status);
    if (next !== draftRef.current) commit(next);
  }, [commit]);

  const allPresent = useCallback(() => {
    if (validatingRef.current || !draftRef.current) return;
    commit(markAllPresent(draftRef.current));
    setFeedback({ kind: "info", message: CLASS_ROLL_CALL_COPY.allPresentDone });
  }, [commit]);

  const runValidation = useCallback(async () => {
    const current = draftRef.current;
    if (validatingRef.current || !current) return; // double validation bloquée
    validatingRef.current = true;
    setValidating(true);
    await stopScan();
    try {
      const outcome = await validateClassRollCall(current, { validate: validateCompleteClassRollCall });
      if (outcome.kind === "validated") {
        onValidated(outcome.message);
        return;
      }
      if (outcome.kind === "roster_changed") {
        setFeedback({ kind: "error", message: outcome.message });
        await loadRoster("reload");
        return;
      }
      if (outcome.kind === "cards_invalid" || outcome.kind === "expired") commit(outcome.draft);
      setFeedback({ kind: "error", message: outcome.message });
    } finally {
      validatingRef.current = false;
      setValidating(false);
    }
  }, [commit, loadRoster, onValidated, stopScan]);

  /** Récapitulatif obligatoire avec le nombre exact d'absents avant tout enregistrement. */
  const review = useCallback(() => {
    if (validatingRef.current || !classRollCallCanSubmit(draftRef.current)) return;
    const counts = classRollCallCounts(draftRef.current);
    Alert.alert(CLASS_ROLL_CALL_COPY.confirmTitle, CLASS_ROLL_CALL_COPY.confirmBody(counts), [
      { text: CLASS_ROLL_CALL_COPY.cancel, style: "cancel" },
      { text: CLASS_ROLL_CALL_COPY.confirm, onPress: () => void runValidation() },
    ]);
  }, [runValidation]);

  const close = useCallback(() => {
    if (validatingRef.current) return;
    void stopScan();
    onClose();
  }, [onClose, stopScan]);

  const abandon = useCallback(() => {
    if (validatingRef.current) return;
    Alert.alert(CLASS_ROLL_CALL_COPY.abandonConfirmTitle, CLASS_ROLL_CALL_COPY.abandonConfirmBody, [
      { text: CLASS_ROLL_CALL_COPY.keep, style: "cancel" },
      {
        text: CLASS_ROLL_CALL_COPY.abandonConfirm,
        style: "destructive",
        onPress: () => {
          void stopScan();
          onAbandon();
        },
      },
    ]);
  }, [onAbandon, stopScan]);

  const counts = classRollCallCounts(draft);
  const canSubmit = !validating && !loading && classRollCallCanSubmit(draft);
  const feedbackStyle = feedback?.kind === "accepted"
    ? styles.feedbackAccepted
    : feedback?.kind === "duplicate" || feedback?.kind === "info"
      ? styles.feedbackNeutral
      : styles.feedbackRefused;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="class-roll-call">
        <Text style={styles.className}>{className}</Text>
        <Text style={styles.title} accessibilityRole="header">{CLASS_ROLL_CALL_COPY.title}</Text>

        <View style={styles.counters} testID="class-roll-call-counters" accessibilityLiveRegion="polite">
          {(["present", "absent", "late", "excused"] as const).map((status) => (
            <View key={status} style={[styles.counterBox, { backgroundColor: STATUS_COLORS[status].bg }]}>
              <Text style={[styles.counterValue, { color: STATUS_COLORS[status].fg }]}>{counts[status]}</Text>
              <Text style={[styles.counterLabel, { color: STATUS_COLORS[status].fg }]}>
                {status === "present" ? "Présents" : status === "absent" ? "Absents" : status === "late" ? "Retards" : "Justifiés"}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.meta}>{CLASS_ROLL_CALL_COPY.draft}</Text>
        <Text style={styles.meta}>{CLASS_ROLL_CALL_COPY.defaultAbsent}</Text>

        {loading ? (
          <View style={styles.panel}>
            <ActivityIndicator color="#2563EB" />
            <Text style={styles.panelText}>{CLASS_ROLL_CALL_COPY.loading}</Text>
          </View>
        ) : null}
        {loadError ? (
          <View style={styles.panel}>
            <Text testID="class-roll-call-load-error" style={[styles.feedback, styles.feedbackRefused]}>{loadError}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => void loadRoster(draft ? "reload" : "open")} accessibilityRole="button">
              <Text style={styles.secondaryText}>Réessayer</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {draft && !loading ? (
          <>
            <View style={styles.actions}>
              <TouchableOpacity
                testID="class-roll-call-all-present"
                style={styles.secondaryButton}
                onPress={allPresent}
                disabled={validating}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>{CLASS_ROLL_CALL_COPY.allPresent}</Text>
              </TouchableOpacity>
              {nfcAvailable ? (
                <TouchableOpacity
                  testID="class-roll-call-scan-nfc"
                  style={styles.secondaryButton}
                  onPress={() => void (scanSource === "nfc" ? stopScan() : startScan("nfc"))}
                  disabled={validating}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>{scanSource === "nfc" ? CLASS_ROLL_CALL_COPY.stopScan : CLASS_ROLL_CALL_COPY.scanNfc}</Text>
                </TouchableOpacity>
              ) : null}
              {qrAvailable ? (
                <TouchableOpacity
                  testID="class-roll-call-scan-qr"
                  style={styles.secondaryButton}
                  onPress={() => void (scanSource === "qr" ? stopScan() : startScan("qr"))}
                  disabled={validating}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>{scanSource === "qr" ? CLASS_ROLL_CALL_COPY.stopScan : CLASS_ROLL_CALL_COPY.scanQr}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {scanSource ? (
              <View style={styles.panel} testID="class-roll-call-scanner">
                {listening ? <ActivityIndicator color="#2563EB" /> : null}
                <Text style={styles.panelText}>
                  {scanSource === "nfc" ? CLASS_ROLL_CALL_COPY.instructionsNfc : CLASS_ROLL_CALL_COPY.instructionsQr}
                </Text>
                {scanSource === "qr" ? (
                  permission?.granted ? (
                    <View style={styles.cameraWrap}>
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
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => void requestPermission()} accessibilityRole="button">
                      <Text style={styles.secondaryText}>Autoriser la caméra</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </View>
            ) : null}

            {feedback ? (
              <Text testID="class-roll-call-feedback" style={[styles.feedback, feedbackStyle]} accessibilityLiveRegion="polite">
                {feedback.message}
              </Text>
            ) : null}

            {draft.students.length === 0 ? <Text style={styles.meta}>{CLASS_ROLL_CALL_COPY.empty}</Text> : null}
            {draft.students.map((student) => {
              const mark = draft.marks[student.studentId];
              const status = mark?.status ?? "absent";
              const locked = isLockedStudent(student);
              const name = studentDisplayName(student);
              return (
                <View key={student.studentId} style={styles.row} testID={`class-roll-call-row-${student.studentId}`}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowName}>{name}</Text>
                    <Text style={[styles.badge, { backgroundColor: STATUS_COLORS[status].bg, color: STATUS_COLORS[status].fg }]}>
                      {STATUS_LABELS[status]}
                      {mark?.source === "default" ? " (provisoire)" : mark?.source === "card" ? " (carte)" : ""}
                    </Text>
                  </View>
                  {locked ? (
                    <Text style={styles.meta}>{CLASS_ROLL_CALL_COPY.lockedHint}</Text>
                  ) : (
                    <View style={styles.choices} accessibilityRole="radiogroup">
                      {EDITABLE_STATUSES.map((choice) => {
                        const selected = status === choice && mark?.source !== "default";
                        return (
                          <TouchableOpacity
                            key={choice}
                            testID={`class-roll-call-${choice}-${student.studentId}`}
                            style={[styles.choice, selected && { backgroundColor: STATUS_COLORS[choice].bg, borderColor: STATUS_COLORS[choice].fg }]}
                            onPress={() => choose(student.studentId, choice)}
                            disabled={validating}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled: validating }}
                            accessibilityLabel={`${name} : ${STATUS_LABELS[choice]}`}
                          >
                            <Text style={styles.choiceText}>{STATUS_LABELS[choice]}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}

            <TouchableOpacity
              testID="class-roll-call-review"
              style={[styles.primaryButton, !canSubmit && styles.disabled]}
              onPress={review}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: validating }}
            >
              {validating ? <ActivityIndicator color="#FFFFFF" /> : null}
              <Text style={styles.primaryText}>{validating ? CLASS_ROLL_CALL_COPY.validating : CLASS_ROLL_CALL_COPY.review}</Text>
            </TouchableOpacity>
          </>
        ) : null}

        <TouchableOpacity testID="class-roll-call-close" style={styles.secondaryButton} onPress={close} disabled={validating} accessibilityRole="button">
          <Text style={styles.secondaryText}>{CLASS_ROLL_CALL_COPY.close}</Text>
        </TouchableOpacity>
        {draft ? (
          <TouchableOpacity testID="class-roll-call-abandon" style={styles.dangerButton} onPress={abandon} disabled={validating} accessibilityRole="button">
            <Text style={styles.dangerText}>{CLASS_ROLL_CALL_COPY.abandon}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20, paddingBottom: 40 },
  className: { color: "#2563EB", fontWeight: "900", fontSize: 16 },
  title: { marginTop: 4, fontSize: 26, fontWeight: "900", color: "#0F172A" },
  counters: { marginTop: 16, flexDirection: "row", gap: 8 },
  counterBox: { flex: 1, borderRadius: 14, paddingVertical: 10, alignItems: "center" },
  counterValue: { fontSize: 26, fontWeight: "900" },
  counterLabel: { fontWeight: "800", fontSize: 12 },
  meta: { marginTop: 8, color: "#64748B", fontWeight: "700" },
  actions: { marginTop: 8 },
  panel: { marginTop: 12, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14 },
  panelText: { color: "#0F172A", fontWeight: "800", textAlign: "center" },
  cameraWrap: { marginTop: 12, height: 240, borderRadius: 16, overflow: "hidden", backgroundColor: "#0F172A" },
  camera: { flex: 1 },
  feedback: { marginTop: 12, fontWeight: "900", textAlign: "center", padding: 10, borderRadius: 12 },
  feedbackAccepted: { color: "#166534", backgroundColor: "#DCFCE7" },
  feedbackNeutral: { color: "#334155", backgroundColor: "#F1F5F9" },
  feedbackRefused: { color: "#B45309", backgroundColor: "#FEF3C7" },
  row: { marginTop: 10, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 12 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rowName: { flex: 1, color: "#0F172A", fontWeight: "900" },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontWeight: "900", overflow: "hidden" },
  choices: { marginTop: 8, flexDirection: "row", gap: 8 },
  choice: {
    flex: 1, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 12, borderWidth: 1, borderColor: "#CBD5E1",
    alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF",
  },
  choiceText: { color: "#0F172A", fontWeight: "800" },
  primaryButton: {
    marginTop: 16, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 16, backgroundColor: "#2563EB",
    alignItems: "center", justifyContent: "center", padding: 12, flexDirection: "row", gap: 8,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  disabled: { opacity: 0.5 },
  secondaryButton: {
    marginTop: 10, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center", padding: 12,
  },
  secondaryText: { color: "#334155", fontWeight: "900" },
  dangerButton: {
    marginTop: 10, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center", padding: 12, borderWidth: 1, borderColor: "#FCA5A5",
  },
  dangerText: { color: "#B91C1C", fontWeight: "900" },
});
