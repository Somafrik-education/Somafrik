/**
 * NFC-PRESENCE-01 — individual NFC attendance scan session (no react-native import, testable).
 *
 * Bug fixed: the parent passed inline callbacks, so every parent re-render (in particular the
 * one triggered by `onAttendanceRecorded`) recreated `runScan` / `listenForTag` and re-ran the
 * listening effect, which cleared the result and restarted the read: the user saw
 * "Identification en cours…" then "Approchez la carte…" with no result and no error.
 *
 * Rules:
 * - the listening effect only depends on `visible`; changing props are read through a ref;
 * - each outcome ends with a visible state (result, or explicit message) — never a silent return
 *   while the scanner is still open;
 * - `busy` is always released when the read ends.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  STUDENT_CARD_SCAN_COPY,
  hasValidSelectedClass,
  holdCardToken,
  isStaleScanScope,
  releaseCardToken,
  runStudentCardScanFlow,
  studentCardScanErrorMessage,
  type AttendanceAuthorReady,
  type ScanScopeSnapshot,
  type SelectedAttendanceClassRef,
  type StudentCardScanFlowDeps,
  type StudentCardScanView,
  type VolatileCardToken,
} from "./studentCardScan";
import {
  STUDENT_CARD_NFC_COPY,
  decideNfcScannerRead,
  releaseNfcSession,
  scanNfcCardToken,
  type NfcHardware,
  type NfcReadFailure,
} from "./studentCardNfc";

export const NFC_ATTENDANCE_COPY = {
  teacherUnresolved: "Choisissez l’enseignant auteur de l’appel avant de pointer.",
  interrupted: "Lecture interrompue avant la fin. Aucun résultat n’a été confirmé : réessayez.",
} as const;

export type NfcAttendanceScannerApi = Pick<
  StudentCardScanFlowDeps,
  "resolveCard" | "recordAttendance" | "readFinance" | "createIdempotencyKey"
>;

export type NfcAttendanceScannerOptions = {
  visible: boolean;
  hardware: NfcHardware;
  resourceScopeKey: string;
  schoolCode: string;
  selectedClass: SelectedAttendanceClassRef;
  author: AttendanceAuthorReady;
  attendanceDate: string;
  financeEnabled: boolean;
  isOffline: () => boolean;
  api: NfcAttendanceScannerApi;
  onAttendanceRecorded: (view: StudentCardScanView) => void;
};

export type NfcAttendanceScanner = {
  busy: boolean;
  scanning: boolean;
  error: string;
  failure: NfcReadFailure | "";
  result: StudentCardScanView | null;
  /** Explicit "scan another card": clears the previous result and listens again. */
  retry: () => void;
  /** Cancels the read in progress and releases the NFC session (close, fallback, scope change). */
  stop: () => Promise<void>;
  /** Clears the displayed outcome. */
  reset: () => void;
  /** App moved to background: cancel the read without closing the scanner. */
  cancelForBackground: (decision: { cancelSession?: boolean; releaseToken?: boolean; clearResult?: boolean }) => void;
};

export function useNfcAttendanceScanner(options: NfcAttendanceScannerOptions): NfcAttendanceScanner {
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<NfcReadFailure | "">("");
  const [result, setResult] = useState<StudentCardScanView | null>(null);
  const tokenRef = useRef<VolatileCardToken>({ current: null });
  const generationRef = useRef(0);
  const scanLockRef = useRef(false);
  const visibleRef = useRef(options.visible);
  // Latest props: read at call time so a parent re-render never restarts the read.
  const latestRef = useRef(options);
  latestRef.current = options;
  visibleRef.current = options.visible;

  const scope = useCallback((): ScanScopeSnapshot => {
    const current = latestRef.current;
    return {
      generation: generationRef.current,
      resourceScopeKey: current.resourceScopeKey,
      schoolCode: current.schoolCode,
      classId: String(current.selectedClass.classId ?? "").trim(),
      classCode: String(current.selectedClass.classCode ?? "").trim(),
    };
  }, []);

  const stop = useCallback(async () => {
    generationRef.current += 1;
    setScanning(false);
    setBusy(false);
    releaseCardToken(tokenRef.current);
    await releaseNfcSession(latestRef.current.hardware);
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError("");
    setFailure("");
  }, []);

  const runScan = useCallback(async (cardToken: string) => {
    const props = latestRef.current;
    if (!hasValidSelectedClass(props.selectedClass)) {
      setError(STUDENT_CARD_SCAN_COPY.classMismatch);
      return;
    }
    const started = scope();
    const stillOpen = () => visibleRef.current && !isStaleScanScope(started, scope());
    setBusy(true);
    setError("");
    try {
      const outcome = await runStudentCardScanFlow({
        cardToken,
        scope: started,
        selectedClass: props.selectedClass,
        author: props.author,
        attendanceDate: props.attendanceDate,
        financeEnabled: props.financeEnabled,
        parallelFinance: true,
        singleRequestAttendance: true,
        isOffline: props.isOffline,
        currentScope: scope,
        resolveCard: props.api.resolveCard,
        recordAttendance: props.api.recordAttendance,
        readFinance: props.api.readFinance,
        createIdempotencyKey: props.api.createIdempotencyKey,
      });
      if (!stillOpen()) return; // scanner closed / scope changed: its own reset already ran
      switch (outcome.kind) {
        case "success":
          setResult(outcome.view);
          if (outcome.view.attendanceRecorded) latestRef.current.onAttendanceRecorded(outcome.view);
          return;
        case "offline":
          setError(STUDENT_CARD_SCAN_COPY.offline);
          return;
        case "teacher_unresolved":
          setError(NFC_ATTENDANCE_COPY.teacherUnresolved);
          return;
        case "invalid_card":
          setError(STUDENT_CARD_SCAN_COPY.invalidCard);
          return;
        case "class_mismatch":
          setResult(outcome.view);
          setError(STUDENT_CARD_SCAN_COPY.classMismatch);
          return;
        case "error":
          setError(outcome.message);
          return;
        default:
          // "stale" while still open: never silent.
          setError(NFC_ATTENDANCE_COPY.interrupted);
      }
    } catch (caught) {
      if (stillOpen()) setError(studentCardScanErrorMessage(caught));
    } finally {
      releaseCardToken(tokenRef.current);
      setBusy(false);
    }
  }, [scope]);

  const listenForTag = useCallback(async () => {
    if (!visibleRef.current || scanLockRef.current) return;
    scanLockRef.current = true;
    const startedGeneration = generationRef.current;
    setScanning(true);
    setError("");
    setFailure("");
    setResult(null);
    try {
      const read = await scanNfcCardToken(latestRef.current.hardware);
      if (!visibleRef.current || startedGeneration !== generationRef.current) return;
      const decision = decideNfcScannerRead(read);
      if (decision.callOnClose || decision.navigateHome) return;
      if (!decision.runAttendance || !decision.token) {
        setFailure(decision.refusal ?? "error");
        setError(decision.message);
        return;
      }
      if (!holdCardToken(tokenRef.current, decision.token)) return;
      setScanning(false);
      await runScan(decision.token);
    } catch (caught) {
      if (visibleRef.current && startedGeneration === generationRef.current) {
        setFailure("error");
        setError(studentCardScanErrorMessage(caught));
      }
    } finally {
      scanLockRef.current = false;
      setScanning(false);
      setBusy(false);
    }
  }, [runScan]);

  // Starts one read per opening. Depends on `visible` only (listenForTag / stop are stable).
  useEffect(() => {
    if (!options.visible) {
      generationRef.current += 1;
      reset();
      void stop();
      return;
    }
    generationRef.current += 1;
    void listenForTag();
  }, [listenForTag, options.visible, reset, stop]);

  useEffect(() => () => {
    generationRef.current += 1;
    releaseCardToken(tokenRef.current);
    void releaseNfcSession(latestRef.current.hardware);
  }, []);

  const retry = useCallback(() => {
    releaseCardToken(tokenRef.current);
    setResult(null);
    void listenForTag();
  }, [listenForTag]);

  const cancelForBackground = useCallback<NfcAttendanceScanner["cancelForBackground"]>((decision) => {
    if (decision.cancelSession) {
      generationRef.current += 1;
      setScanning(false);
      setBusy(false);
      void releaseNfcSession(latestRef.current.hardware);
    }
    if (decision.releaseToken) releaseCardToken(tokenRef.current);
    if (decision.clearResult) setResult(null);
  }, []);

  return { busy, scanning, error, failure, result, retry, stop, reset, cancelForBackground };
}

/** Status line: a recorded presence stays visible until the user asks for another card. */
export function nfcScannerPanelText(state: {
  busy: boolean;
  scanning: boolean;
  error: string;
  result: StudentCardScanView | null;
}): string {
  if (state.busy) return STUDENT_CARD_SCAN_COPY.resolving;
  if (state.scanning) return STUDENT_CARD_NFC_COPY.scanning;
  if (state.error) return state.error;
  if (state.result?.attendanceRecorded) return STUDENT_CARD_SCAN_COPY.attendanceRecorded;
  return STUDENT_CARD_NFC_COPY.scanning;
}

export function nfcScannerRetryLabel(result: StudentCardScanView | null): string {
  return result ? STUDENT_CARD_SCAN_COPY.rearm : STUDENT_CARD_NFC_COPY.retry;
}
