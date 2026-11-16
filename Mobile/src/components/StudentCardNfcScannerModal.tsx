import { useCallback, useEffect, useRef } from "react";
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
  scanScopeKey,
  type AttendanceAuthorReady,
  type SelectedAttendanceClassRef,
  type StudentCardScanView,
} from "../lib/studentCardScan";
import {
  STUDENT_CARD_NFC_COPY,
  decideNfcScannerForeground,
  shouldShowNfcQrFallback,
  type NfcHardware,
} from "../lib/studentCardNfc";
import { createReactNativeNfcAdapter } from "../lib/studentCardNfcNative";
import {
  nfcScannerPanelText,
  nfcScannerRetryLabel,
  useNfcAttendanceScanner,
  type NfcAttendanceScannerApi,
} from "../lib/studentCardNfcAttendanceScanner";
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

const SCAN_API: NfcAttendanceScannerApi = {
  resolveCard: resolveStudentCard,
  recordAttendance: (token, attendance, idempotencyKey) =>
    recordStudentCardAttendance(token, attendance, { idempotencyKey }),
  readFinance: readStudentCardFinance,
  createIdempotencyKey,
};

/**
 * Read flow (runStudentCardScanFlow, scanNfcCardToken, decideNfcScannerRead, holdCardToken,
 * releaseCardToken, releaseNfcSession) lives in useNfcAttendanceScanner: the listening effect
 * depends on `visible` only, so the parent's inline callbacks never restart or wipe a scan.
 */
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
  const hardwareRef = useRef<NfcHardware>(hardware ?? createReactNativeNfcAdapter());
  if (hardware) hardwareRef.current = hardware;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onFallbackQrRef = useRef(onFallbackQr);
  onFallbackQrRef.current = onFallbackQr;

  const scanner = useNfcAttendanceScanner({
    visible,
    hardware: hardwareRef.current,
    resourceScopeKey,
    schoolCode,
    selectedClass,
    author,
    attendanceDate,
    financeEnabled,
    isOffline,
    api: SCAN_API,
    onAttendanceRecorded,
  });
  const { busy, scanning, error, failure, result, retry, stop, reset, cancelForBackground } = scanner;

  const scopeKey = scanScopeKey({
    resourceScopeKey,
    schoolCode,
    classId: selectedClass.classId,
    classCode: selectedClass.classCode,
  });
  const lastScopeRef = useRef(scopeKey);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      cancelForBackground(decideNfcScannerForeground({ nextAppState: next, visible: visibleRef.current }));
    });
    return () => sub.remove();
  }, [cancelForBackground]);

  useEffect(() => {
    if (!visible) {
      lastScopeRef.current = scopeKey;
      return;
    }
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    reset();
    void stop();
    onCloseRef.current();
  }, [reset, scopeKey, stop, visible]);

  const close = useCallback(() => {
    void stop();
    reset();
    onCloseRef.current();
  }, [reset, stop]);

  const fallbackQr = useCallback(() => {
    void stop();
    reset();
    if (qrFallbackEnabled !== true) return;
    onFallbackQrRef.current();
  }, [qrFallbackEnabled, reset, stop]);

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
            {nfcScannerPanelText({ busy, scanning, error, result })}
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
          accessibilityLabel={nfcScannerRetryLabel(result)}
          accessibilityState={{ disabled: busy || scanning }}
        >
          <Text style={styles.secondaryText}>{nfcScannerRetryLabel(result)}</Text>
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
