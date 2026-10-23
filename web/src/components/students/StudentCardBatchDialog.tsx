import { useEffect, useReducer, useRef, useState } from "react";
import { Button, InlineAlert, Modal } from "../../design-system";
import { formatDateTimeForDisplay } from "../../lib/dates";
import type { SchoolLogoSource } from "../../lib/schoolLogo";
import { studentCardBatchApi } from "../../lib/studentCardBatchApi";
import {
  assembleBatchPrintDocument,
  loadBatchPrintIdentities,
  loadBatchPrintSchoolLogo,
  renderBatchPrintDocument,
  type BatchPrintIdentity,
} from "../../lib/studentCardBatchPrintable";
import { cardVisualReport, cardVisualReportMessage, type CardVisual } from "../../lib/studentCardDesign";
import {
  canActivateBatch,
  canConfirmDocumentSave,
  classifyBatchError,
  exclusionReasonLabel,
  explicitPrepareAllowed,
  initialBatchFlow,
  reduceBatchFlow,
  saveStudentCardBatchDocument,
  suggestedCardDocumentName,
  type BatchFlowState,
  type DocumentSaveEnvironment,
  type PreparedCardSecret,
  type PublicBatchEntry,
} from "../../lib/studentCardBatchSession";

interface StudentCardBatchDialogProps {
  open: boolean;
  classCode: string;
  className: string;
  schoolName?: string | null;
  /** Établissement actif : source du logo intégré au document CR80 (CARTE-BATCH-DESIGN-01). */
  school?: SchoolLogoSource;
  onClose: () => void;
  loadPrintIdentities?: (input: {
    classCode: string;
    schoolName: string | null;
    className: string | null;
    studentIds: readonly string[];
  }) => Promise<BatchPrintIdentity[]>;
  /** Logo intégré au document CR80 (CARTE-BATCH-DESIGN-01). Par défaut : logo de l'établissement actif. */
  loadSchoolLogo?: (school: SchoolLogoSource) => Promise<CardVisual>;
  saveDocument?: (
    textBody: string,
    filename: string,
    env: DocumentSaveEnvironment,
  ) => Promise<{ verified: boolean; bytesWritten: number; cancelled: boolean }>;
}

function forget(secrets: { current: PreparedCardSecret[] }, nonce: { current: string | null }) {
  secrets.current = [];
  nonce.current = null;
}

function entryLabel(entry: PublicBatchEntry): string {
  if (entry.decision === "already_active" || entry.outcome === "skipped_active") {
    return "Carte déjà active — non réexportée";
  }
  if (entry.decision === "ineligible") return exclusionReasonLabel(entry.reason);
  if (entry.decision === "prepared") return "QR préparé, non actif";
  if (entry.decision === "issue_candidate") return "Éligible";
  if (entry.outcome === "activated") return "Activée";
  return "Inclus dans le lot";
}

function defaultSaveEnvironment(): DocumentSaveEnvironment {
  if (typeof window === "undefined") return {};
  const host = window as Window & DocumentSaveEnvironment;
  const picker = host.showSaveFilePicker?.bind(window);
  return { showSaveFilePicker: picker, document };
}

export function StudentCardBatchDialog({
  open,
  classCode,
  className,
  schoolName = null,
  school = null,
  onClose,
  loadPrintIdentities = loadBatchPrintIdentities,
  loadSchoolLogo = loadBatchPrintSchoolLogo,
  saveDocument = saveStudentCardBatchDocument,
}: StudentCardBatchDialogProps) {
  const [state, dispatch] = useReducer(reduceBatchFlow, classCode, initialBatchFlow);
  const [visualNotice, setVisualNotice] = useState<string | null>(null);
  const secretsRef = useRef<PreparedCardSecret[]>([]);
  const nonceRef = useRef<string | null>(null);
  const classNameRef = useRef(className);
  classNameRef.current = className;

  useEffect(() => {
    if (!state.secretsHeld) secretsRef.current = [];
    if (!state.nonceHeld) nonceRef.current = null;
  }, [state.secretsHeld, state.nonceHeld]);

  useEffect(() => {
    if (!open) {
      forget(secretsRef, nonceRef);
      return;
    }
    let cancelled = false;
    forget(secretsRef, nonceRef);
    setVisualNotice(null);
    dispatch({ type: "reset", classCode });
    void (async () => {
      try {
        const preflight = await studentCardBatchApi.preflight(classCode);
        if (!cancelled) dispatch({ type: "preflight_ok", preflight });
      } catch (error) {
        if (!cancelled) dispatch({ type: "failure", failure: classifyBatchError(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, classCode]);

  function close() {
    forget(secretsRef, nonceRef);
    onClose();
  }

  async function onPrepare() {
    if (!explicitPrepareAllowed(state)) return;
    dispatch({ type: "preparing" });
    try {
      const split = await studentCardBatchApi.prepare(classCode);
      if (!split.ok || !split.nonce || !split.view.batchId || split.secrets.length === 0) {
        forget(secretsRef, nonceRef);
        if (split.ok && split.view.status === "not_prepared") {
          dispatch({
            type: "preflight_ok",
            preflight: {
              classCode,
              className: split.view.className,
              counts: {
                issueCandidates: 0,
                alreadyActive: split.view.counts.alreadyActive ?? 0,
                ineligible: split.view.counts.ineligible ?? 0,
              },
              entries: split.view.entries
                .filter(
                  (entry): entry is PublicBatchEntry & { decision: "already_active" | "ineligible" | "issue_candidate" } =>
                    entry.decision === "already_active" ||
                    entry.decision === "ineligible" ||
                    entry.decision === "issue_candidate",
                )
                .map((entry) => ({
                  studentId: entry.studentId,
                  decision: entry.decision,
                  reason: entry.reason,
                })),
            },
          });
          return;
        }
        dispatch({ type: "unusable", view: split.view });
        return;
      }
      secretsRef.current = split.secrets;
      nonceRef.current = split.nonce;
      dispatch({
        type: "prepared",
        view: split.view,
        secretsHeld: true,
        nonceHeld: true,
      });
      await sendTechnical(split.view.batchId, split.nonce);
    } catch (error) {
      forget(secretsRef, nonceRef);
      const failure = classifyBatchError(error);
      if (failure.kind === "lost") dispatch({ type: "response_lost" });
      else dispatch({ type: "failure", failure });
    }
  }

  async function sendTechnical(batchId: string, nonce: string) {
    try {
      const view = await studentCardBatchApi.receiptTechnical(classCode, batchId, nonce);
      dispatch({ type: "received", view });
    } catch (error) {
      const failure = classifyBatchError(error);
      if (failure.kind === "lost") dispatch({ type: "receipt_lost" });
      else dispatch({ type: "failure", failure });
    }
  }

  async function onRetryTechnical() {
    const nonce = nonceRef.current;
    if (!nonce || !state.batchId) return;
    dispatch({ type: "receiving" });
    await sendTechnical(state.batchId, nonce);
  }

  async function onSaveDocument() {
    const secrets = secretsRef.current;
    if (!state.batchId || secrets.length === 0) return;
    setVisualNotice(null);
    let identities: BatchPrintIdentity[];
    let schoolLogo: CardVisual;
    try {
      schoolLogo = await loadSchoolLogo(school).catch((): CardVisual => ({ state: "unavailable" }));
      identities = await loadPrintIdentities({
        classCode,
        schoolName,
        className: state.className ?? classNameRef.current,
        studentIds: secrets.map((card) => card.studentId),
      });
    } catch {
      dispatch({
        type: "notice",
        message: "Le document CR80 ne peut pas être produit. Les cartes ne seront pas activées.",
      });
      return;
    }
    const assembled = assembleBatchPrintDocument(
      {
        batchId: state.batchId,
        classCode,
        className: state.className ?? classNameRef.current,
        expiresAt: state.expiresAt,
        schoolLogo,
      },
      secrets,
      identities,
    );
    if (!assembled.ok) {
      dispatch({ type: "notice", message: assembled.message });
      return;
    }
    const printable = await renderBatchPrintDocument(assembled.value);
    if (!printable.ok) {
      dispatch({ type: "notice", message: printable.message });
      return;
    }
    const saved = await saveDocument(printable.value, suggestedCardDocumentName(classCode), defaultSaveEnvironment());
    if (saved.cancelled || !saved.verified || saved.bytesWritten <= 0) return;
    setVisualNotice(
      cardVisualReportMessage(
        cardVisualReport(assembled.value.schoolLogo, assembled.value.cards.map((card) => card.photo)),
      ),
    );
    dispatch({ type: "document_saved", bytesWritten: saved.bytesWritten, printableConverted: true });
  }

  async function onConfirmSave() {
    if (!canConfirmDocumentSave(state) || !state.batchId) return;
    const secrets = secretsRef.current;
    dispatch({ type: "saving" });
    try {
      const view = await studentCardBatchApi.receiptSaved(classCode, state.batchId, secrets);
      if (view.status !== "saved") dispatch({ type: "save_lost" });
      else dispatch({ type: "saved", view });
    } catch (error) {
      const failure = classifyBatchError(error);
      if (failure.kind === "lost") dispatch({ type: "save_lost" });
      else dispatch({ type: "failure", failure });
    }
  }

  async function onActivate() {
    if (!canActivateBatch(state) || !state.batchId) return;
    const secrets = secretsRef.current;
    dispatch({ type: "activating" });
    try {
      const view = await studentCardBatchApi.activate(classCode, state.batchId, secrets);
      forget(secretsRef, nonceRef);
      dispatch({ type: "activated", view });
    } catch (error) {
      const failure = classifyBatchError(error);
      if (failure.kind === "lost") dispatch({ type: "activation_lost" });
      else dispatch({ type: "failure", failure });
    }
  }

  async function onAbort() {
    if (!state.batchId) return;
    try {
      const view = await studentCardBatchApi.abort(classCode, state.batchId);
      forget(secretsRef, nonceRef);
      dispatch({ type: "aborted", view });
    } catch (error) {
      const failure = classifyBatchError(error);
      dispatch({ type: "failure", failure });
    }
  }

  async function onRefresh() {
    if (!state.batchId) return;
    try {
      const view = await studentCardBatchApi.read(classCode, state.batchId);
      if (view.status === "expired" || view.status === "activated") forget(secretsRef, nonceRef);
      dispatch({ type: "refreshed", view });
    } catch (error) {
      const failure = classifyBatchError(error);
      if (failure.kind === "lost") return;
      if (failure.kind === "expired") forget(secretsRef, nonceRef);
      dispatch({ type: "failure", failure });
    }
  }

  const busy =
    state.phase === "preparing" ||
    state.phase === "receiving" ||
    state.phase === "saving" ||
    state.phase === "activating" ||
    state.phase === "preflight_loading";
  const showRoster = state.phase !== "denied" && state.phase !== "not_found" && state.phase !== "pending_blocked";
  const expiresLabel = state.expiresAt ? formatDateTimeForDisplay(state.expiresAt) : "";

  return (
    <Modal
      open={open}
      size="lg"
      title="Cartes élèves"
      description={className || classCode}
      onClose={close}
      footer={<Footer state={state} busy={busy} onPrepare={() => void onPrepare()} onRetryTechnical={() => void onRetryTechnical()} onSaveDocument={() => void onSaveDocument()} onConfirmSave={() => void onConfirmSave()} onActivate={() => void onActivate()} onAbort={() => void onAbort()} onRefresh={() => void onRefresh()} onClose={close} />}
    >
      {state.phase === "preflight_loading" ? <p className="text-sm text-ink">Chargement du précontrôle…</p> : null}
      {state.message ? (
        <InlineAlert tone={state.phase === "activated" ? "success" : "warning"} title="Lot de cartes">
          {state.message}
        </InlineAlert>
      ) : null}
      {showRoster ? <Summary state={state} /> : null}
      {expiresLabel ? <p className="mt-3 text-sm text-muted">Expiration du lot : {expiresLabel}</p> : null}
      {state.phase === "pending_blocked" ? (
        <div className="mt-4">
          <p className="text-sm text-ink">Identifiants publics du lot ouvert. Aucun secret n'est disponible.</p>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {state.publicIds.map((publicId) => (
              <li key={publicId}>{publicId}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {showRoster && state.entries.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {state.entries.map((entry) => (
            <li key={`${entry.studentId}:${entry.decision}:${entry.publicId ?? ""}`} className="text-sm text-ink">
              <span className="font-semibold">{entry.studentId}</span>
              {" — "}
              <span>{entryLabel(entry)}</span>
              {entry.publicId ? <span className="text-muted"> — {entry.publicId}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.phase === "awaiting_save" || state.phase === "save_lost" ? (
        <label className="mt-4 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={state.operatorConfirmedSave}
            disabled={!state.documentSaveVerified || busy}
            onChange={(event) => dispatch({ type: "operator_confirmed", confirmed: event.target.checked })}
          />
          <span>
            Je confirme avoir enregistré ce document CR80. L'aperçu ne suffit pas à activer les cartes.
          </span>
        </label>
      ) : null}
      {state.documentBytes ? (
        <p className="mt-2 text-sm text-muted">
          Document CR80 enregistré ({state.documentBytes} octets). Il permet d'imprimer les cartes sans nouvelle
          émission.
        </p>
      ) : null}
      {state.documentBytes && visualNotice ? (
        <p className="mt-2 text-sm text-muted" data-testid="card-batch-visual-notice">
          {visualNotice}
        </p>
      ) : null}
    </Modal>
  );
}

function Summary({ state }: { state: BatchFlowState }) {
  return (
    <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
      <div>
        <dt className="text-muted">Éligibles</dt>
        <dd className="font-semibold text-ink">{state.issueCandidates}</dd>
      </div>
      <div>
        <dt className="text-muted">Cartes déjà actives</dt>
        <dd className="font-semibold text-ink">{state.alreadyActive}</dd>
      </div>
      <div>
        <dt className="text-muted">Exclus</dt>
        <dd className="font-semibold text-ink">{state.ineligible}</dd>
      </div>
    </dl>
  );
}

function Footer({
  state,
  busy,
  onPrepare,
  onRetryTechnical,
  onSaveDocument,
  onConfirmSave,
  onActivate,
  onAbort,
  onRefresh,
  onClose,
}: {
  state: BatchFlowState;
  busy: boolean;
  onPrepare: () => void;
  onRetryTechnical: () => void;
  onSaveDocument: () => void;
  onConfirmSave: () => void;
  onActivate: () => void;
  onAbort: () => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const prepareLabel =
    state.phase === "response_lost" ? "Contrôler le lot" : state.phase === "preflight" ? "Préparer les cartes" : "Préparer un nouveau lot";
  return (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Fermer
      </Button>
      {state.batchId && state.phase !== "activated" && state.phase !== "aborted" ? (
        <Button type="button" variant="secondary" onClick={onRefresh} disabled={busy}>
          Actualiser le lot
        </Button>
      ) : null}
      {state.batchId && (state.phase === "pending_blocked" || state.phase === "unusable" || state.phase === "receipt_lost" || state.phase === "awaiting_save" || state.phase === "save_lost") ? (
        <Button type="button" variant="secondary" onClick={onAbort} disabled={busy}>
          Abandonner le lot
        </Button>
      ) : null}
      {explicitPrepareAllowed(state) ? (
        <Button type="button" onClick={onPrepare} disabled={busy}>
          {state.phase === "preparing" ? "Préparation…" : prepareLabel}
        </Button>
      ) : null}
      {state.phase === "receipt_lost" ? (
        <Button type="button" onClick={onRetryTechnical} disabled={busy || !state.nonceHeld}>
          Renvoyer l'accusé technique
        </Button>
      ) : null}
      {state.phase === "awaiting_save" || state.phase === "save_lost" ? (
        <Button type="button" variant="secondary" onClick={onSaveDocument} disabled={busy || !state.secretsHeld}>
          Enregistrer le document CR80
        </Button>
      ) : null}
      {state.phase === "awaiting_save" || state.phase === "save_lost" ? (
        <Button type="button" onClick={onConfirmSave} disabled={busy || !canConfirmDocumentSave(state)}>
          Confirmer la sauvegarde
        </Button>
      ) : null}
      {canActivateBatch(state) ? (
        <Button type="button" onClick={onActivate} disabled={busy}>
          {state.phase === "activation_lost" ? "Réessayer l'activation" : "Activer les cartes"}
        </Button>
      ) : null}
    </>
  );
}
