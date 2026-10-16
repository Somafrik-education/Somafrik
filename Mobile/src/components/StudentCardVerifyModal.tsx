import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  CARD_VERIFY_COPY,
  cardVerifyErrorMessage,
  describeCardVerification,
  type CardVerifyView,
} from "../lib/studentCardVerify";
import { releaseNfcSession, scanNfcCardToken, type NfcHardware } from "../lib/studentCardNfc";
import { createReactNativeNfcAdapter } from "../lib/studentCardNfcNative";
import { extractQrCapability, isQrBarcodeType } from "../lib/studentCardScan";
import { verifyStudentCardToken } from "../services/studentCardVerifyApi";

type Props = {
  visible: boolean;
  source: "nfc" | "qr";
  hardware?: NfcHardware;
  onClose: () => void;
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

export default function StudentCardVerifyModal({ visible, source, hardware, onClose }: Props) {
  const [view, setView] = useState<CardVerifyView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const hardwareRef = useRef<NfcHardware | null>(hardware ?? null);
  const generationRef = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  if (hardware) hardwareRef.current = hardware;

  const nfcHardware = useCallback(() => {
    hardwareRef.current ??= createReactNativeNfcAdapter();
    return hardwareRef.current;
  }, []);

  const stopReader = useCallback(async () => {
    generationRef.current += 1;
    setListening(false);
    if (hardwareRef.current) await closeNfcReader(hardwareRef.current);
  }, []);

  const verifyToken = useCallback(async (cardToken: string, own: number) => {
    setBusy(true);
    try {
      const response = await verifyStudentCardToken(cardToken);
      if (own !== generationRef.current || !visibleRef.current) return;
      setView(describeCardVerification(response));
    } catch (error) {
      if (own !== generationRef.current || !visibleRef.current) return;
      setMessage(cardVerifyErrorMessage(error));
    } finally {
      if (own === generationRef.current) setBusy(false);
    }
  }, []);

  const startNfc = useCallback(async () => {
    await stopReader();
    if (!visibleRef.current) return;
    const own = generationRef.current;
    setView(null);
    setMessage("");
    setListening(true);
    const read = await scanNfcCardToken(nfcHardware());
    if (own !== generationRef.current || !visibleRef.current) return;
    setListening(false);
    if (read.ok) {
      await verifyToken(read.token, own);
      return;
    }
    if (read.reason === "cancelled") return;
    setMessage(read.reason === "unsupported" || read.reason === "disabled"
      ? CARD_VERIFY_COPY.nfcUnavailable
      : read.reason === "error" ? CARD_VERIFY_COPY.failed : CARD_VERIFY_COPY.notSomafrik);
  }, [nfcHardware, stopReader, verifyToken]);

  useEffect(() => {
    if (!visible) {
      void stopReader();
      setView(null);
      setMessage("");
      setBusy(false);
      return;
    }
    generationRef.current += 1;
    if (source === "nfc") void startNfc();
    return () => {
      void stopReader();
    };
  }, [source, startNfc, stopReader, visible]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") void stopReader();
    });
    return () => sub.remove();
  }, [stopReader]);

  useEffect(() => {
    if (visible && source === "qr" && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission, source, visible]);

  const onBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (busy || view || message || !isQrBarcodeType(result.type)) return;
    const value = extractQrCapability(result.data);
    if (!value) return;
    void verifyToken(value, generationRef.current);
  }, [busy, message, verifyToken, view]);

  const another = useCallback(() => {
    setView(null);
    setMessage("");
    if (source === "nfc") void startNfc();
  }, [source, startNfc]);

  const close = useCallback(() => {
    void stopReader();
    onClose();
  }, [onClose, stopReader]);

  const showCamera = source === "qr" && permission?.granted && !busy && !view && !message;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{CARD_VERIFY_COPY.title}</Text>
        <Text style={styles.subtitle}>
          {source === "nfc" ? CARD_VERIFY_COPY.instructionsNfc : CARD_VERIFY_COPY.instructionsQr}
        </Text>

        {showCamera ? (
          <View style={styles.cameraWrap} testID="card-verify-camera">
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          </View>
        ) : null}

        {busy || listening ? (
          <View style={styles.panel}>
            <ActivityIndicator color="#2563EB" />
            <Text style={styles.panelText}>{busy ? CARD_VERIFY_COPY.checking : CARD_VERIFY_COPY.instructionsNfc}</Text>
          </View>
        ) : null}

        {view ? (
          <View
            testID="card-verify-result"
            style={[styles.result, view.tone === "invalid" ? styles.resultInvalid : view.tone === "valid" ? styles.resultValid : null]}
          >
            <Text style={styles.headline}>{view.headline}</Text>
            {view.hint ? <Text style={styles.meta}>{view.hint}</Text> : null}
            {view.rows.map((row) => (
              <View key={`${row.label}-${row.value}`} style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {message ? <Text testID="card-verify-error" style={styles.error}>{message}</Text> : null}

        {view || message ? (
          <TouchableOpacity testID="card-verify-another" style={styles.primaryButton} onPress={another} accessibilityRole="button">
            <Text style={styles.primaryText}>{CARD_VERIFY_COPY.another}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity testID="card-verify-close" style={styles.secondaryButton} onPress={close} accessibilityRole="button">
          <Text style={styles.secondaryText}>{CARD_VERIFY_COPY.close}</Text>
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
  cameraWrap: { marginTop: 16, height: 260, borderRadius: 20, overflow: "hidden", backgroundColor: "#0F172A" },
  camera: { flex: 1 },
  panel: { marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 16, alignItems: "center" },
  panelText: { marginTop: 8, color: "#0F172A", fontWeight: "800" },
  result: { marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 16, borderWidth: 2, borderColor: "#E2E8F0" },
  resultValid: { borderColor: "#86EFAC" },
  resultInvalid: { borderColor: "#FCA5A5" },
  headline: { fontSize: 20, fontWeight: "900", color: "#0F172A" },
  meta: { marginTop: 6, color: "#64748B", fontWeight: "700" },
  row: { marginTop: 10 },
  rowLabel: { color: "#64748B", fontWeight: "800" },
  rowValue: { color: "#0F172A", fontWeight: "900" },
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
