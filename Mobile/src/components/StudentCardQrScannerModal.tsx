import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  STUDENT_CARD_SCAN_COPY,
  decideCameraPermissionPrompt,
  decideQrScannerForeground,
  extractQrCapability,
  hasValidSelectedClass,
  holdCardToken,
  isQrBarcodeType,
  isQrScannerCameraLive,
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
  onClose: () => void;
  onAttendanceRecorded: (view: StudentCardScanView) => void;
};

export default function StudentCardQrScannerModal({
  visible,
  selectedClass,
  resourceScopeKey,
  schoolCode,
  author,
  attendanceDate,
  financeEnabled,
  isOffline = isOfflineContext,
  onClose,
  onAttendanceRecorded,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StudentCardScanView | null>(null);
  const tokenRef = useRef<VolatileCardToken>({ current: null });
  const requestedRef = useRef(false);
  const generationRef = useRef(0);
  const visibleRef = useRef(visible);
  const permissionGrantedRef = useRef(Boolean(permission?.granted));
  const busyRef = useRef(busy);
  const resultRef = useRef(result);
  visibleRef.current = visible;
  permissionGrantedRef.current = Boolean(permission?.granted);
  busyRef.current = busy;
  resultRef.current = result;
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

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const decision = decideQrScannerForeground({
        nextAppState: next,
        visible: visibleRef.current,
        permissionGranted: permissionGrantedRef.current,
        busy: busyRef.current,
        hasResult: resultRef.current != null,
      });
      setAppActive(decision.appActive);
      if (decision.releaseToken) releaseCardToken(tokenRef.current);
      if (decision.clearResult) setResult(null);
      if (decision.rearmCamera) setPaused(false);
      else if (decision.pauseCamera) setPaused(true);
    });
    return () => {
      sub.remove();
      releaseCardToken(tokenRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      releaseCardToken(tokenRef.current);
      requestedRef.current = false;
      setResult(null);
      setError("");
      setBusy(false);
      setPaused(false);
      return;
    }
    generationRef.current += 1;
    setPaused(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const decision = decideCameraPermissionPrompt({
      visible: true,
      permission,
      alreadyRequested: requestedRef.current,
    });
    if (decision === "wait") return;
    if (decision === "granted") {
      requestedRef.current = true;
      if (!busyRef.current && resultRef.current == null) setPaused(false);
      return;
    }
    if (decision === "blocked") {
      requestedRef.current = true;
      return;
    }
    if (decision === "request") {
      requestedRef.current = true;
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

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
    setPaused(true);
    onClose();
  }, [onClose, scopeKey, visible]);

  const cameraLive = isQrScannerCameraLive({
    visible,
    appActive,
    permissionGranted: Boolean(permission?.granted),
    paused,
    hasResult: result != null,
    busy,
  });

  const runScan = useCallback(
    async (cardToken: string) => {
      if (!hasValidSelectedClass(selectedClass)) {
        setError(STUDENT_CARD_SCAN_COPY.classMismatch);
        setPaused(true);
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
        if (stillCurrent()) {
          setBusy(false);
          setPaused(true);
        }
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

  const onBarcodeScanned = useCallback(
    (scanningResult: BarcodeScanningResult) => {
      if (!cameraLive) return;
      if (!isQrBarcodeType(scanningResult.type)) return;
      const payload = extractQrCapability(scanningResult.data);
      if (!holdCardToken(tokenRef.current, payload)) return;
      setPaused(true);
      void runScan(payload);
    },
    [cameraLive, runScan],
  );

  const rearm = useCallback(() => {
    releaseCardToken(tokenRef.current);
    setResult(null);
    setError("");
    setPaused(false);
  }, []);

  const close = useCallback(() => {
    releaseCardToken(tokenRef.current);
    setResult(null);
    setError("");
    setPaused(true);
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{STUDENT_CARD_SCAN_COPY.title}</Text>
        <Text style={styles.subtitle}>{STUDENT_CARD_SCAN_COPY.subtitle}</Text>

        {!permission ? (
          <View style={styles.cameraPlaceholder}>
            <ActivityIndicator color="#2563EB" />
          </View>
        ) : !permission.granted ? (
          <View style={styles.panel}>
            <Text style={styles.panelText}>
              {permission.canAskAgain === false
                ? STUDENT_CARD_SCAN_COPY.permissionBlocked
                : STUDENT_CARD_SCAN_COPY.permissionDenied}
            </Text>
            {permission.canAskAgain === false ? (
              <TouchableOpacity
                testID="student-card-scan-open-settings"
                style={styles.secondaryButton}
                onPress={() => void Linking.openSettings()}
                accessibilityRole="button"
                accessibilityLabel={STUDENT_CARD_SCAN_COPY.openSettings}
              >
                <Text style={styles.secondaryText}>{STUDENT_CARD_SCAN_COPY.openSettings}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID="student-card-scan-request-permission"
                style={styles.primaryButton}
                onPress={() => void requestPermission()}
                accessibilityRole="button"
                accessibilityLabel={STUDENT_CARD_SCAN_COPY.requestPermission}
              >
                <Text style={styles.primaryText}>{STUDENT_CARD_SCAN_COPY.requestPermission}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : cameraLive ? (
          <View style={styles.cameraWrap} testID="student-card-scan-camera">
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          </View>
        ) : (
          <View style={styles.cameraPlaceholder}>
            {busy ? <ActivityIndicator color="#2563EB" /> : null}
            <Text style={styles.meta}>
              {busy ? STUDENT_CARD_SCAN_COPY.resolving : STUDENT_CARD_SCAN_COPY.cameraUnavailable}
            </Text>
          </View>
        )}

        {error ? (
          <Text testID="student-card-scan-error" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {result ? (
          <View testID="student-card-scan-result" style={styles.result}>
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
          testID="student-card-scan-rearm"
          style={styles.secondaryButton}
          onPress={rearm}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={STUDENT_CARD_SCAN_COPY.rearm}
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.secondaryText}>{STUDENT_CARD_SCAN_COPY.rearm}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="student-card-scan-close"
          style={styles.backButton}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={STUDENT_CARD_SCAN_COPY.close}
        >
          <Ionicons name="close" size={18} color="#0F172A" />
          <Text style={styles.backText}>{STUDENT_CARD_SCAN_COPY.close}</Text>
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
  cameraWrap: {
    marginTop: 16,
    height: 320,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#0F172A",
  },
  camera: { flex: 1 },
  cameraPlaceholder: {
    marginTop: 16,
    height: 180,
    borderRadius: 24,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  panel: {
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
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
  primaryButton: {
    marginTop: 12,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
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
