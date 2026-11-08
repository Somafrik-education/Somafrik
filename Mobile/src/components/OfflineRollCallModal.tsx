/**
 * NFC-PRES-LOCAL-PR3 — interface de l'appel de classe hors connexion (NFC / QR).
 *
 * Réutilise le lecteur NFC natif existant (`createRollCallNfcLoop`, `scanNfcCardToken`, adaptateur
 * `react-native-nfc-manager`, mode lecteur conservé entre deux cartes) et la caméra QR existante.
 * Aucun appel HTTP par scan : chaque lecture est enregistrée dans SQLCipher et le résultat n'est
 * affiché qu'après COMMIT. Aucune clôture automatique. Aucun état « Synchronisé » (PR4).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { createRollCallNfcLoop } from "../lib/studentCardRollCall";
import { releaseNfcSession, scanNfcCardToken, type NfcHardware } from "../lib/studentCardNfc";
import { createReactNativeNfcAdapter } from "../lib/studentCardNfcNative";
import { extractQrCapability, isQrBarcodeType } from "../lib/studentCardScan";
import {
  OFFLINE_ROLL_CALL_COPY,
  STATUS_LABEL,
  closeOfflineRollCall,
  degradedReasonLabel,
  openOfflineRollCall,
  packLoader,
  prepareOfflinePack,
  processCard,
  setOfflineMark,
  summarizeOfflineRollCall,
  type EditableStatus,
  type OfflinePackState,
  type OfflineRollCall,
  type OfflineRollCallSummary,
} from "../offline/rollCall/session/offlineRollCall";
import { rollCallRuntime } from "../offline/rollCall/runtime/rollCallRuntime";
import { findLatestSession, type RcContext } from "../offline/rollCall/store/repository";
import { downloadOfflineRollCallPack } from "../services/rollCallOfflineApi";

const QR_REPEAT_COOLDOWN_MS = 3_000;
const EDITABLE: readonly EditableStatus[] = ["present", "late", "absent"];

type SessionLike = Parameters<ReturnType<typeof rollCallRuntime>["activate"]>[0];

type Props = {
  visible: boolean;
  session: SessionLike;
  classId: string;
  className: string;
  date: string;
  nfcAvailable: boolean;
  qrAvailable: boolean;
  hardware?: NfcHardware;
  onClose: () => void;
};

type Feedback = { tone: "ok" | "neutral" | "warn" | "error"; message: string };

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "pending_sync" }
  | { kind: "ready"; ctx: RcContext; rollCall: OfflineRollCall; pack: OfflinePackState }
  | { kind: "closed" };

const TONE_STYLE = {
  ok: { backgroundColor: "#DCFCE7", color: "#166534" },
  neutral: { backgroundColor: "#E0E7FF", color: "#3730A3" },
  warn: { backgroundColor: "#FEF3C7", color: "#92400E" },
  error: { backgroundColor: "#FEE2E2", color: "#991B1B" },
} as const;

async function closeNfcReader(hardware: NfcHardware) {
  await releaseNfcSession(hardware);
  try {
    await (hardware as NfcHardware & { end?: () => Promise<void> }).end?.();
  } catch {
    // déjà libéré
  }
}

export default function OfflineRollCallModal({ visible, session, classId, className, date, nfcAvailable, qrAvailable, hardware, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [summary, setSummary] = useState<OfflineRollCallSummary | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [scanSource, setScanSource] = useState<"nfc" | "qr" | null>(null);
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const busyRef = useRef(false);
  const lastQrRef = useRef<{ value: string; at: number } | null>(null);
  const hardwareRef = useRef<NfcHardware | null>(hardware ?? null);
  const actorUserId = String(session?.user?.id ?? "").toLowerCase();

  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Après chaque écriture locale : compteurs, et état vérifié utilisé par la déconnexion.
  const refresh = useCallback(async (ctx: RcContext, rollCall: OfflineRollCall) => {
    setSummary(await summarizeOfflineRollCall(ctx, rollCall));
    void rollCallRuntime().refreshLogoutGuard(sessionRef.current);
  }, []);

  // Ouverture : base du compte authentifié, pack (réseau si possible), reprise du brouillon.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      setPhase({ kind: "loading" });
      setFeedback(null);
      const runtime = rollCallRuntime();
      const opened = await runtime.activate(session);
      if (cancelled) return;
      if (!opened.ok) {
        setPhase({ kind: "error", message: "message" in opened ? opened.message : "Stockage local indisponible." });
        return;
      }
      const ctx = opened.account.ctx;
      const latest = await findLatestSession(ctx, classId, date);
      if (latest && latest.state !== "draft" && latest.state !== "expired") {
        setPhase({ kind: "pending_sync" });
        return;
      }
      const keyring = runtime.keyring();
      const schoolId = opened.account.identity.schoolId;
      const base = { classId, date, schoolId, actorUserId };
      const pack: OfflinePackState = keyring
        ? await prepareOfflinePack(ctx, { ...base, keyring, download: () => downloadOfflineRollCallPack({ classId, date }) })
        : { status: "degraded", reason: "RC_PACK_KEY_UNKNOWN", downloadFailed: false };
      const rollCall = await openOfflineRollCall(ctx, {
        classId,
        date,
        pack: pack.status === "verified" ? pack.verified : null,
        loadPack: keyring ? packLoader(ctx, { ...base, keyring }) : undefined,
      });
      if (cancelled) return;
      setPhase({ kind: "ready", ctx, rollCall, pack });
      await refresh(ctx, rollCall);
      if (rollCall.resumed) setFeedback({ tone: "neutral", message: "Brouillon repris : les cartes déjà scannées sont conservées." });
    })().catch(() => {
      if (!cancelled) setPhase({ kind: "error", message: OFFLINE_ROLL_CALL_COPY.storageError });
    });
    return () => {
      cancelled = true;
    };
  }, [actorUserId, classId, date, refresh, session, visible]);

  /** Une lecture : preuve locale, COMMIT, puis affichage. Jamais de requête réseau. */
  const submitToken = useCallback(
    async (token: string, medium: "nfc" | "qr"): Promise<{ stop: boolean }> => {
      const current = phaseRef.current;
      if (current.kind !== "ready" || busyRef.current) return { stop: false };
      busyRef.current = true;
      try {
        const outcome = await processCard(current.ctx, current.rollCall, { token, medium, actorUserId });
        const tone: Feedback["tone"] =
          outcome.kind === "recorded" ? "ok" : outcome.kind === "refused" || outcome.kind === "invalid_card" ? "error" : outcome.kind === "unknown" ? "warn" : "neutral";
        setFeedback({ tone, message: outcome.message });
        if (outcome.kind !== "invalid_card") await refresh(current.ctx, current.rollCall);
        return { stop: outcome.kind === "refused" && outcome.code === "RC_SESSION_NOT_DRAFT" };
      } finally {
        busyRef.current = false;
      }
    },
    [actorUserId, refresh],
  );

  const submitRef = useRef(submitToken);
  submitRef.current = submitToken;
  const nfcHardware = useCallback(() => {
    hardwareRef.current ??= createReactNativeNfcAdapter();
    return hardwareRef.current;
  }, []);
  const loopRef = useRef<ReturnType<typeof createRollCallNfcLoop> | null>(null);
  loopRef.current ??= createRollCallNfcLoop({
    read: () => scanNfcCardToken(nfcHardware()),
    submit: (token) => submitRef.current(token, "nfc"),
    onFeedback: (value) => setFeedback({ tone: value.kind === "error" ? "error" : "warn", message: value.message }),
    onListening: setListening,
  });

  const stopScan = useCallback(async () => {
    setScanSource(null);
    loopRef.current?.stop();
    if (hardwareRef.current) await closeNfcReader(hardwareRef.current);
  }, []);

  const startScan = useCallback(
    async (source: "nfc" | "qr") => {
      await stopScan();
      setScanSource(source);
      if (source === "nfc") loopRef.current?.start();
      else if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
    },
    [permission, requestPermission, stopScan],
  );

  useEffect(() => {
    if (!visible) void stopScan();
  }, [stopScan, visible]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") void stopScan();
    });
    return () => {
      subscription.remove();
      void stopScan();
    };
  }, [stopScan]);

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (busyRef.current || !isQrBarcodeType(result.type)) return;
      const value = extractQrCapability(result.data);
      if (!value) return;
      const now = Date.now();
      if (lastQrRef.current?.value === value && now - lastQrRef.current.at < QR_REPEAT_COOLDOWN_MS) return;
      lastQrRef.current = { value, at: now };
      void submitToken(value, "qr");
    },
    [submitToken],
  );

  const choose = useCallback(
    async (matchKey: string, status: EditableStatus) => {
      const current = phaseRef.current;
      if (current.kind !== "ready" || busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await setOfflineMark(current.ctx, current.rollCall, { matchKey, status });
        if (!result.ok) setFeedback({ tone: "error", message: result.message });
        await refresh(current.ctx, current.rollCall);
      } finally {
        busyRef.current = false;
      }
    },
    [refresh],
  );

  const confirmClose = useCallback(() => {
    const current = phaseRef.current;
    if (current.kind !== "ready" || !summary) return;
    Alert.alert(OFFLINE_ROLL_CALL_COPY.closeTitle, OFFLINE_ROLL_CALL_COPY.closeBody(summary), [
      { text: OFFLINE_ROLL_CALL_COPY.keepEditing, style: "cancel" },
      {
        text: OFFLINE_ROLL_CALL_COPY.confirmClose,
        onPress: () =>
          void (async () => {
            setSaving(true);
            await stopScan();
            try {
              const closed = await closeOfflineRollCall(current.ctx, current.rollCall);
              void rollCallRuntime().refreshLogoutGuard(sessionRef.current);
              if (closed.ok) {
                setPhase({ kind: "closed" });
                setFeedback({ tone: "ok", message: closed.message });
              } else setFeedback({ tone: "error", message: closed.message });
            } finally {
              setSaving(false);
            }
          })(),
      },
    ]);
  }, [stopScan, summary]);

  const close = useCallback(() => {
    void stopScan();
    onClose();
  }, [onClose, stopScan]);

  const ready = phase.kind === "ready" ? phase : null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="offline-roll-call">
        <Text style={styles.className}>{className}</Text>
        <Text style={styles.title} accessibilityRole="header">{OFFLINE_ROLL_CALL_COPY.title}</Text>
        <Text style={styles.meta}>Appel du {date}</Text>

        {phase.kind === "loading" ? (
          <View style={styles.panel}>
            <ActivityIndicator color="#2563EB" />
            <Text style={styles.panelText}>{OFFLINE_ROLL_CALL_COPY.preparing}</Text>
          </View>
        ) : null}
        {phase.kind === "error" ? <Text style={[styles.feedback, TONE_STYLE.error]} testID="offline-roll-call-error">{phase.message}</Text> : null}
        {phase.kind === "pending_sync" || phase.kind === "closed" ? (
          <Text style={[styles.feedback, TONE_STYLE.neutral]} testID="offline-roll-call-pending-sync">
            {OFFLINE_ROLL_CALL_COPY.closed}
          </Text>
        ) : null}

        {ready ? (
          <>
            <Text style={[styles.feedback, ready.pack.status === "verified" && ready.rollCall.pack ? TONE_STYLE.ok : TONE_STYLE.warn]} testID="offline-roll-call-pack">
              {ready.pack.status === "verified" && ready.rollCall.pack
                ? OFFLINE_ROLL_CALL_COPY.packReady(ready.rollCall.pack.pack.issuedAt.slice(0, 16).replace("T", " à ") + " UTC")
                : `${OFFLINE_ROLL_CALL_COPY.degraded} (${degradedReasonLabel(ready.pack.status === "degraded" ? ready.pack.reason : "RC_PACK_NONE")})`}
            </Text>
            {summary ? (
              <View style={styles.counters} testID="offline-roll-call-counters" accessibilityLiveRegion="polite">
                {[
                  ["Élèves", summary.total === null ? "—" : String(summary.total)],
                  ["Présents", String(summary.present)],
                  ["Restants", summary.total === null ? "—" : String(summary.remaining)],
                  ["À vérifier", String(summary.unknownScans)],
                ].map(([label, value]) => (
                  <View key={label} style={styles.counterBox}>
                    <Text style={styles.counterValue}>{value}</Text>
                    <Text style={styles.counterLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={styles.meta}>{OFFLINE_ROLL_CALL_COPY.localSaved} {summary ? `${summary.scans} lecture(s).` : ""}</Text>

            <View style={styles.actions}>
              {nfcAvailable ? (
                <TouchableOpacity testID="offline-roll-call-nfc" style={styles.button} onPress={() => void (scanSource === "nfc" ? stopScan() : startScan("nfc"))} disabled={saving} accessibilityRole="button">
                  <Text style={styles.buttonText}>{scanSource === "nfc" ? "Arrêter le scan" : "Scanner les cartes NFC"}</Text>
                </TouchableOpacity>
              ) : null}
              {qrAvailable ? (
                <TouchableOpacity testID="offline-roll-call-qr" style={styles.button} onPress={() => void (scanSource === "qr" ? stopScan() : startScan("qr"))} disabled={saving} accessibilityRole="button">
                  <Text style={styles.buttonText}>{scanSource === "qr" ? "Arrêter le scan" : "Scanner les QR codes"}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {scanSource ? (
              <View style={styles.panel}>
                {listening ? <ActivityIndicator color="#2563EB" /> : null}
                <Text style={styles.panelText}>{scanSource === "nfc" ? "Présentez les cartes NFC successivement." : "Présentez les QR codes successivement devant la caméra."}</Text>
                {scanSource === "qr" ? (
                  permission?.granted ? (
                    <View style={styles.cameraWrap}>
                      {visible && !saving ? <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onBarcodeScanned} /> : null}
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.button} onPress={() => void requestPermission()} accessibilityRole="button">
                      <Text style={styles.buttonText}>Autoriser la caméra</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </View>
            ) : null}

            {feedback ? (
              <Text testID="offline-roll-call-feedback" style={[styles.feedback, TONE_STYLE[feedback.tone]]} accessibilityLiveRegion="polite">
                {feedback.message}
              </Text>
            ) : null}

            {summary?.rows.map((row) => (
              <View key={row.student.matchKey} style={styles.row} testID={`offline-roll-call-row-${row.student.studentId}`}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowName}>{`${row.student.firstName} ${row.student.lastName}`.trim() || row.student.studentCode}</Text>
                  <Text style={styles.badge}>
                    {row.status ? STATUS_LABEL[row.status] : "Non pointé"}
                    {row.source === "card" ? " (carte)" : row.protected ? " (déjà enregistré)" : ""}
                  </Text>
                </View>
                {row.protected ? null : (
                  <View style={styles.statusRow}>
                    {EDITABLE.map((status) => (
                      <TouchableOpacity
                        key={status}
                        style={[styles.statusButton, row.status === status ? styles.statusSelected : null]}
                        onPress={() => void choose(row.student.matchKey, status)}
                        disabled={saving}
                        accessibilityRole="button"
                        accessibilityState={{ selected: row.status === status }}
                      >
                        <Text style={styles.statusText}>{STATUS_LABEL[status]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}

            <TouchableOpacity testID="offline-roll-call-close" style={[styles.button, styles.primary]} onPress={confirmClose} disabled={saving || !summary} accessibilityRole="button">
              <Text style={[styles.buttonText, styles.primaryText]}>{saving ? "Enregistrement…" : OFFLINE_ROLL_CALL_COPY.closeTitle}</Text>
            </TouchableOpacity>
          </>
        ) : null}

        <TouchableOpacity testID="offline-roll-call-exit" style={styles.button} onPress={close} disabled={saving} accessibilityRole="button">
          <Text style={styles.buttonText}>{phase.kind === "ready" ? "Fermer (garder le brouillon)" : "Fermer"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, gap: 12 },
  className: { fontSize: 14, color: "#475569" },
  title: { fontSize: 22, fontWeight: "700", color: "#0F172A" },
  meta: { fontSize: 13, color: "#475569" },
  panel: { padding: 12, borderRadius: 12, backgroundColor: "#FFFFFF", gap: 8, alignItems: "center" },
  panelText: { fontSize: 14, color: "#0F172A", textAlign: "center" },
  feedback: { padding: 12, borderRadius: 10, fontSize: 15, fontWeight: "600", overflow: "hidden" },
  counters: { flexDirection: "row", gap: 8 },
  counterBox: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  counterValue: { fontSize: 22, fontWeight: "700", color: "#0F172A" },
  counterLabel: { fontSize: 12, color: "#475569" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: MIN_TOUCH_TARGET_DP, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center" },
  buttonText: { fontSize: 15, fontWeight: "600", color: "#0F172A" },
  primary: { backgroundColor: "#1D4ED8", borderColor: "#1D4ED8" },
  primaryText: { color: "#FFFFFF" },
  cameraWrap: { width: "100%", aspectRatio: 1, borderRadius: 12, overflow: "hidden" },
  camera: { flex: 1 },
  row: { padding: 12, borderRadius: 10, backgroundColor: "#FFFFFF", gap: 8 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rowName: { fontSize: 15, fontWeight: "600", color: "#0F172A", flexShrink: 1 },
  badge: { fontSize: 13, color: "#334155" },
  statusRow: { flexDirection: "row", gap: 8 },
  statusButton: { flex: 1, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 8, borderWidth: 1, borderColor: "#CBD5E1", justifyContent: "center", alignItems: "center" },
  statusSelected: { backgroundColor: "#DBEAFE", borderColor: "#1D4ED8" },
  statusText: { fontSize: 14, color: "#0F172A" },
});
