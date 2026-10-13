import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  STUDENT_CARD_SCAN_COPY,
  hasValidSelectedClass,
  holdCardToken,
  isStaleScanScope,
  releaseCardToken,
  runStudentCardScanFlow,
  scanScopeKey,
  type AttendanceAuthorReady,
  type ScanScopeSnapshot,
  type SelectedAttendanceClassRef,
  type StudentCardScanView,
  type VolatileCardToken,
} from "../lib/studentCardScan";
import {
  STUDENT_CARD_NFC_COPY,
  decideNfcScannerForeground,
  decideNfcScannerRead,
  releaseNfcSession,
  scanNfcCardToken,
  shouldShowNfcQrFallback,
  type NfcHardware,
  type NfcReadFailure,
} from "../lib/studentCardNfc";
import { createReactNativeNfcAdapter } from "../lib/studentCardNfcNative";
import {
  readStudentCardFinance,
  recordStudentCardAttendance,
  resolveStudentCard,
} from "../services/studentCardScanApi";
import { createIdempotencyKey } from "../lib/networkResilience";
import { isOfflineContext } from "../lib/connectivity";

type Props = {
  visible: boolean;
  selectedClass: SelectedAttendanceClassRef;
  resourceScopeKey: string;
  schoolCode: string;
  author: AttendanceAuthorReady;
  attendanceDate: string;
  financeEnabled: boolean;
  isOffline?: () => boolean;
  hardware?: NfcHardware;
  qrFallbackEnabled: boolean;
  onClose: () => void;
  onFallbackQr: () => void;
  onAttendanceRecorded: (view: StudentCardScanView) => void;
};

export default function StudentCardNfcScannerModal({
  visible,
  selectedClass,
  resourceScopeKey,
  schoolCode,
  author,
  attendanceDate,
  financeEnabled,
  isOffline = isOfflineContext,
  hardware,
  qrFallbackEnabled,
  onClose,
  onFallbackQr,
  onAttendanceRecorded,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<NfcReadFailure | "">("");
  const [result, setResult] = useState<StudentCardScanView | null>(null);
  const tokenRef = useRef<VolatileCardToken>({ current: null });
  const hardwareRef = useRef<NfcHardware>(hardware ?? createReactNativeNfcAdapter());
  const generationRef = useRef(0);
  const visibleRef = useRef(visible);
  const scanLockRef = useRef(false);
  visibleRef.current = visible;
  if (hardware) hardwareRef.current = hardware;
  const scopeKey = scanScopeKey({
    resourceScopeKey,
    schoolCode,
    classId: selectedClass.classId,
    classCode: selectedClass.classCode,
  });
  const lastScopeRef = useRef(scopeKey);

  const scope = useCallback((): ScanScopeSnapshot => {
    return {
      generation: generationRef.current,
      resourceScopeKey,
      schoolCode,
      classId: String(selectedClass.classId ?? "").trim(),
      classCode: String(selectedClass.classCode ?? "").trim(),
    };
  }, [resourceScopeKey, schoolCode, selectedClass.classCode, selectedClass.classId]);

  const stopSession = useCallback(async () => {
    scanLockRef.current = false;
    setScanning(false);
    releaseCardToken(tokenRef.current);
    await releaseNfcSession(hardwareRef.current);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const decision = decideNfcScannerForeground({
        nextAppState: next,
        visible: visibleRef.current,
      });
      if (decision.cancelSession) {
        scanLockRef.current = false;
        setScanning(false);
        void releaseNfcSession(hardwareRef.current);
      }
      if (decision.releaseToken) releaseCardToken(tokenRef.current);
      if (decision.clearResult) setResult(null);
    });
    return () => {
      sub.remove();
      releaseCardToken(tokenRef.current);
      void releaseNfcSession(hardwareRef.current);
    };
  }, []);

  const runScan = useCallback(
    async (cardToken: string) => {
      if (!hasValidSelectedClass(selectedClass)) {
        setError(STUDENT_CARD_SCAN_COPY.classMismatch);
        return;
      }
      const started = scope();
      setBusy(true);
      setError("");
      const stillCurrent = () => !isStaleScanScope(started, scope());
      try {
        const outcome = await runStudentCardScanFlow({
          cardToken,
          scope: started,
          selectedClass,
          author,
          attendanceDate,
          financeEnabled,
          isOffline,
          currentScope: scope,
          resolveCard: resolveStudentCard,
          recordAttendance: (token, attendance, idempotencyKey) =>
            recordStudentCardAttendance(token, attendance, { idempotencyKey }),
          readFinance: readStudentCardFinance,
          createIdempotencyKey,
        });
        if (!stillCurrent()) return;
        if (outcome.kind === "offline") {
          setError(STUDENT_CARD_SCAN_COPY.offline);
          return;
        }
        if (outcome.kind === "teacher_unresolved") {
          setError("Choisissez l’enseignant auteur de l’appel avant de pointer.");
          return;
        }
        if (outcome.kind === "invalid_card") {
          setError(STUDENT_CARD_SCAN_COPY.invalidCard);
          return;
        }
        if (outcome.kind === "class_mismatch") {
          setResult(outcome.view);
          setError(STUDENT_CARD_SCAN_COPY.classMismatch);
          return;
        }
        if (outcome.kind === "error") {
          setError(outcome.message);
          return;
        }
        if (outcome.kind === "stale") return;
        setResult(outcome.view);
        if (outcome.view.attendanceRecorded) onAttendanceRecorded(outcome.view);
      } finally {
        releaseCardToken(tokenRef.current);
        if (stillCurrent()) setBusy(false);
      }
    },
    [
      attendanceDate,
      author,
      financeEnabled,
      isOffline,
      onAttendanceRecorded,
      scope,
      selectedClass,
    ],
  );

  const listenForTag = useCallback(async () => {
    if (!visibleRef.current || scanLockRef.current) return;
    scanLockRef.current = true;
    setScanning(true);
    setError("");
    setFailure("");
    setResult(null);
    try {
      const read = await scanNfcCardToken(hardwareRef.current);
      if (!visibleRef.current) return;
      const decision = decideNfcScannerRead(read);
      if (decision.callOnClose || decision.navigateHome) return;
      if (!decision.runAttendance || !decision.token) {
        setFailure(decision.refusal ?? "error");
        setError(decision.message);
        return;
      }
      if (!holdCardToken(tokenRef.current, decision.token)) return;
      await runScan(decision.token);
    } finally {
      scanLockRef.current = false;
      if (visibleRef.current) setScanning(false);
    }
  }, [runScan]);

  useEffect(() => {
    if (!visible) {
      generationRef.current += 1;
      setResult(null);
      setError("");
      setFailure("");
      setBusy(false);
      void stopSession();
      return;
    }
    generationRef.current += 1;
    void listenForTag();
  }, [listenForTag, stopSession, visible]);

  useEffect(() => {
    if (!visible) {
      lastScopeRef.current = scopeKey;
      return;
    }
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    generationRef.current += 1;
    releaseCardToken(tokenRef.current);
    setResult(null);
    setError("");
    void stopSession();
    onClose();
  }, [onClose, scopeKey, stopSession, visible]);

  const close = useCallback(() => {
    void stopSession();
    setResult(null);
    setError("");
    setFailure("");
    onClose();
  }, [onClose, stopSession]);

  const fallbackQr = useCallback(() => {
    void stopSession();
    setResult(null);
    setError("");
    setFailure("");
    if (qrFallbackEnabled !== true) return;
    onFallbackQr();
  }, [onFallbackQr, qrFallbackEnabled, stopSession]);

  const retry = useCallback(() => {
    releaseCardToken(tokenRef.current);
    setResult(null);
    void listenForTag();
  }, [listenForTag]);

  const showQrFallback = shouldShowNfcQrFallback({
    qrFallbackEnabled,
    failure,
    hasError: Boolean(error),
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{STUDENT_CARD_NFC_COPY.title}</Text>
        <Text style={styles.subtitle}>{STUDENT_CARD_NFC_COPY.subtitle}</Text>

        <View style={styles.panel} testID="student-card-nfc-status">
          {busy ? <ActivityIndicator color="#2563EB" /> : null}
          <Text style={styles.panelText}>
            {busy
              ? STUDENT_CARD_SCAN_COPY.resolving
              : scanning
                ? STUDENT_CARD_NFC_COPY.scanning
                : error || STUDENT_CARD_NFC_COPY.scanning}
          </Text>
        </View>

        {error ? (
          <Text testID="student-card-nfc-error" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {result ? (
          <View testID="student-card-nfc-result" style={styles.result}>
            <Text style={styles.resultName}>{result.studentName}</Text>
            {result.studentCode ? <Text style={styles.meta}>Matricule : {result.studentCode}</Text> : null}
            {result.className ? <Text style={styles.meta}>Classe : {result.className}</Text> : null}
            {result.attendanceRecorded ? (
              <Text style={styles.meta}>{STUDENT_CARD_SCAN_COPY.attendanceRecorded}</Text>
            ) : null}
            {result.financeLabel ? (
              <>
                <Text style={styles.meta}>Finance : {result.financeLabel}</Text>
                <Text style={styles.meta}>{STUDENT_CARD_SCAN_COPY.financeNotice}</Text>
              </>
            ) : null}
            {result.financeUnavailable ? (
              <Text style={styles.meta}>{STUDENT_CARD_SCAN_COPY.financeUnavailable}</Text>
            ) : null}
          </View>
        ) : null}

        <TouchableOpacity
          testID="student-card-nfc-retry"
          style={styles.secondaryButton}
          onPress={retry}
          disabled={busy || scanning}
          accessibilityRole="button"
          accessibilityLabel={STUDENT_CARD_NFC_COPY.retry}
          accessibilityState={{ disabled: busy || scanning }}
        >
          <Text style={styles.secondaryText}>{STUDENT_CARD_NFC_COPY.retry}</Text>
        </TouchableOpacity>
        {showQrFallback ? (
          <TouchableOpacity
            testID="student-card-nfc-use-qr"
            style={styles.secondaryButton}
            onPress={fallbackQr}
            accessibilityRole="button"
            accessibilityLabel={STUDENT_CARD_NFC_COPY.useQr}
          >
            <Text style={styles.secondaryText}>{STUDENT_CARD_NFC_COPY.useQr}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          testID="student-card-nfc-close"
          style={styles.backButton}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={STUDENT_CARD_NFC_COPY.close}
        >
          <Ionicons name="close" size={18} color="#0F172A" />
          <Text style={styles.backText}>{STUDENT_CARD_NFC_COPY.close}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, color: "#64748B", fontWeight: "700" },
  meta: { marginTop: 8, color: "#64748B", fontWeight: "700" },
  panel: {
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    minHeight: 88,
    justifyContent: "center",
  },
  panelText: { color: "#0F172A", fontWeight: "700" },
  result: {
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
  },
  resultName: { fontSize: 20, fontWeight: "900", color: "#0F172A" },
  error: { marginTop: 12, color: "#B45309", fontWeight: "800" },
  secondaryButton: {
    marginTop: 12,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  secondaryText: { color: "#334155", fontWeight: "900" },
  backButton: {
    marginTop: 12,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  backText: { color: "#0F172A", fontWeight: "900", marginLeft: 8 },
});
