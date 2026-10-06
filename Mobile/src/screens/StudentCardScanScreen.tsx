import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canManagePresences, canReadFeeGrids } from "../domain/security/permissions";
import { isOfflineContext } from "../lib/connectivity";
import { createIdempotencyKey } from "../lib/networkResilience";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import {
  STUDENT_CARD_SCAN_COPY,
  extractQrCapability,
  holdCardToken,
  isQrBarcodeType,
  isStudentCardScanAttendanceEnabled,
  isStudentCardScanFinanceEnabled,
  isoAttendanceDate,
  releaseCardToken,
  studentCardScanErrorMessage,
  type VolatileCardToken,
} from "../lib/studentCardScan";
import { getSchoolSettings, type SchoolSettings } from "../services/schoolSettingsApi";
import { scanStudentCard, type StudentCardScanResponse } from "../services/studentCardsApi";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "StudentCardScan">;

type ScanResultView = {
  studentName: string;
  studentCode: string;
  className: string;
  attendanceLabel: string;
  financeLabel: string;
};

function displayName(response: StudentCardScanResponse): string {
  const first = String(response.student?.firstName ?? "").trim();
  const last = String(response.student?.lastName ?? "").trim();
  return `${first} ${last}`.trim() || "Élève identifié";
}

export default function StudentCardScanScreen({ navigation, route }: Props) {
  const scrollContentPaddingBottom = useStackScreenBottomPadding();
  const { session } = useAuth();
  const { loadPresences } = useAdminData();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<"present" | "late">("present");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResultView | null>(null);
  const tokenRef = useRef<VolatileCardToken>({ current: null });
  const requestedRef = useRef(false);

  const schoolCode = String(session?.school?.code ?? session?.user?.schoolCode ?? "").trim();
  const canScan = canManagePresences(session);
  const canReadFinance = canReadFeeGrids(session);
  const attendanceEnabled = canScan && isStudentCardScanAttendanceEnabled(settings);
  const financeEnabled = canReadFinance && isStudentCardScanFinanceEnabled(settings);
  const teacherId = String(route.params?.teacherId ?? "").trim();
  const attendanceDate = String(route.params?.attendanceDate ?? "").trim() || isoAttendanceDate();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isFocused) {
      releaseCardToken(tokenRef.current);
      requestedRef.current = false;
    }
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused || !canScan || requestedRef.current || permission?.granted) return;
    requestedRef.current = true;
    void requestPermission();
  }, [canScan, isFocused, permission?.granted, requestPermission]);

  useEffect(() => {
    if (!isFocused || !schoolCode) return;
    let cancelled = false;
    void getSchoolSettings(schoolCode)
      .then((row) => {
        if (!cancelled) setSettings(row);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isFocused, schoolCode]);

  const cameraLive =
    Boolean(isFocused && appActive && permission?.granted && !paused && !result && !busy && canScan);

  const clearVolatile = useCallback(() => {
    releaseCardToken(tokenRef.current);
  }, []);

  const runScan = useCallback(
    async (cardToken: string) => {
      if (isOfflineContext()) {
        setError(STUDENT_CARD_SCAN_COPY.offline);
        clearVolatile();
        setPaused(true);
        return;
      }
      setBusy(true);
      setError("");
      try {
        let latest = await scanStudentCard({ cardToken });
        let attendanceLabel = "";
        if (attendanceEnabled) {
          const attendanceBody: {
            date: string;
            status: "present" | "late";
            teacherId?: string;
          } = {
            date: attendanceDate,
            status: attendanceStatus,
          };
          if (teacherId) attendanceBody.teacherId = teacherId;
          latest = await scanStudentCard(
            { cardToken, attendance: attendanceBody },
            { idempotencyKey: createIdempotencyKey() },
          );
          attendanceLabel = String(latest.attendance?.status ?? (attendanceStatus === "late" ? "Retard" : "Présent"));
          void loadPresences();
        }
        let financeLabel = "";
        if (financeEnabled) {
          const finance = await scanStudentCard({ cardToken, finance: true });
          financeLabel = String(finance.finance?.label ?? "");
          latest = { ...latest, finance: finance.finance };
        }
        setResult({
          studentName: displayName(latest),
          studentCode: String(latest.student?.studentCode ?? "").trim(),
          className: String(latest.class?.className ?? "").trim(),
          attendanceLabel,
          financeLabel,
        });
      } catch (caught) {
        setError(studentCardScanErrorMessage(caught));
        setPaused(true);
      } finally {
        clearVolatile();
        setBusy(false);
      }
    },
    [
      attendanceDate,
      attendanceEnabled,
      attendanceStatus,
      clearVolatile,
      financeEnabled,
      loadPresences,
      teacherId,
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
    clearVolatile();
    setResult(null);
    setError("");
    setPaused(false);
  }, [clearVolatile]);

  const goBackToManual = useCallback(() => {
    clearVolatile();
    navigation.goBack();
  }, [clearVolatile, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: scrollContentPaddingBottom, padding: 20 }}>
      <Text style={styles.title}>{STUDENT_CARD_SCAN_COPY.title}</Text>
      <Text style={styles.subtitle}>{STUDENT_CARD_SCAN_COPY.subtitle}</Text>

      {attendanceEnabled ? (
        <View style={styles.modeRow}>
          <Text style={styles.modeLabel}>{STUDENT_CARD_SCAN_COPY.modeLabel}</Text>
          <View style={styles.modeActions}>
            <TouchableOpacity
              testID="student-card-scan-present"
              style={[styles.modeButton, attendanceStatus === "present" && styles.modeButtonSelected]}
              onPress={() => setAttendanceStatus("present")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected: attendanceStatus === "present", disabled: busy }}
              accessibilityLabel={STUDENT_CARD_SCAN_COPY.present}
            >
              <Text style={[styles.modeText, attendanceStatus === "present" && styles.modeTextSelected]}>
                {STUDENT_CARD_SCAN_COPY.present}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="student-card-scan-late"
              style={[styles.modeButton, attendanceStatus === "late" && styles.modeButtonLate]}
              onPress={() => setAttendanceStatus("late")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected: attendanceStatus === "late", disabled: busy }}
              accessibilityLabel={STUDENT_CARD_SCAN_COPY.late}
            >
              <Text style={[styles.modeText, attendanceStatus === "late" && styles.modeTextSelected]}>
                {STUDENT_CARD_SCAN_COPY.late}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {!permission ? (
        <View style={styles.cameraPlaceholder}>
          <ActivityIndicator color="#2563EB" />
        </View>
      ) : !permission.granted ? (
        <View style={styles.panel}>
          <Text style={styles.panelText}>
            {permission?.canAskAgain === false
              ? STUDENT_CARD_SCAN_COPY.permissionBlocked
              : STUDENT_CARD_SCAN_COPY.permissionDenied}
          </Text>
          {permission?.canAskAgain === false ? (
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
          {result.attendanceLabel ? <Text style={styles.meta}>Présence : {result.attendanceLabel}</Text> : null}
          {result.financeLabel ? (
            <>
              <Text style={styles.meta}>Finance : {result.financeLabel}</Text>
              <Text style={styles.meta}>{STUDENT_CARD_SCAN_COPY.financeNotice}</Text>
            </>
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
        testID="student-card-scan-back-manual"
        style={styles.backButton}
        onPress={goBackToManual}
        accessibilityRole="button"
        accessibilityLabel={STUDENT_CARD_SCAN_COPY.backToManual}
      >
        <Ionicons name="arrow-back" size={18} color="#0F172A" />
        <Text style={styles.backText}>{STUDENT_CARD_SCAN_COPY.backToManual}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, color: "#64748B", fontWeight: "700" },
  meta: { marginTop: 8, color: "#64748B", fontWeight: "700" },
  modeRow: { marginTop: 16 },
  modeLabel: { color: "#0F172A", fontWeight: "800", marginBottom: 8 },
  modeActions: { flexDirection: "row", gap: 10 },
  modeButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  modeButtonSelected: { backgroundColor: "#16A34A" },
  modeButtonLate: { backgroundColor: "#D97706" },
  modeText: { color: "#334155", fontWeight: "900" },
  modeTextSelected: { color: "#FFFFFF" },
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
