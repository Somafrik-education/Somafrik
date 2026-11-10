import { ApiError } from "../api/client";
import { getEntityFeaturePermissions, type PermissionContext } from "./permissions";

/** Libellé du bouton de classe. Le PDF A4 est un lot ultérieur. */
export const CLASS_CARD_BATCH_BUTTON_LABEL = "Émettre / exporter les cartes";

export const BATCH_LOST_RESPONSE_MESSAGE =
  "La réponse n'a pas été reçue. Aucune nouvelle émission automatique.";

const EXCLUSION_REASONS: Record<string, string> = {
  CARD_STATE_UNDETERMINED: "État de la carte indéterminé",
  NOT_ELIGIBLE: "Élève non éligible",
  HOLDER_UNDETERMINED: "Titulaire indéterminé",
};

export interface ClassCardPreflightEntry {
  studentId: string;
  decision: "issue_candidate" | "already_active" | "ineligible";
  reason: string | null;
}

export interface ClassCardPreflight {
  classCode: string;
  className: string | null;
  entries: ClassCardPreflightEntry[];
  counts: {
    issueCandidates: number;
    alreadyActive: number;
    ineligible: number;
  };
}

export interface PublicBatchEntry {
  studentId: string;
  decision: string;
  reason: string | null;
  publicId: string | null;
  outcome: string | null;
  cardStatus: string | null;
  scannable: boolean;
}

export interface PublicBatchView {
  batchId: string | null;
  classCode: string | null;
  className: string | null;
  status: string;
  expiresAt: string | null;
  receivedAt: string | null;
  savedAt: string | null;
  activatedAt: string | null;
  secretsIncluded: false;
  secretsRecoverable: false;
  counts: {
    prepared?: number;
    alreadyActive?: number;
    ineligible?: number;
    activated?: number;
    skippedActive?: number;
    voided?: number;
  };
  entries: PublicBatchEntry[];
}

export interface PreparedCardSecret {
  studentId: string;
  publicId: string;
  cardToken: string;
  secret: string;
}

export interface PrepareSplit {
  ok: boolean;
  view: PublicBatchView;
  nonce: string | null;
  secrets: PreparedCardSecret[];
}

export interface PendingBatch {
  batchId: string;
  status: string;
  classCode: string;
  expiresAt: string | null;
  publicIds: string[];
  secretsRecoverable: false;
}

export type BatchFailureKind =
  | "pending"
  | "expired"
  | "lost"
  | "denied"
  | "not_found"
  | "proof"
  | "receipt_required"
  | "save_required"
  | "activated"
  | "qr_disabled"
  | "disabled"
  | "rejected";

export interface BatchFailure {
  kind: BatchFailureKind;
  message: string;
  pending: PendingBatch | null;
}

export type BatchFlowPhase =
  | "preflight_loading"
  | "preflight"
  | "not_prepared"
  | "preparing"
  | "response_lost"
  | "pending_blocked"
  | "receiving"
  | "receipt_lost"
  | "awaiting_save"
  | "saving"
  | "save_lost"
  | "awaiting_activation"
  | "activating"
  | "activation_lost"
  | "activated"
  | "expired"
  | "aborted"
  | "denied"
  | "not_found"
  | "unusable"
  | "error";

export interface BatchFlowState {
  classCode: string;
  phase: BatchFlowPhase;
  status: string | null;
  batchId: string | null;
  expiresAt: string | null;
  className: string | null;
  issueCandidates: number;
  alreadyActive: number;
  ineligible: number;
  entries: PublicBatchEntry[];
  publicIds: string[];
  secretsRecoverable: false;
  secretsHeld: boolean;
  nonceHeld: boolean;
  documentSaveVerified: boolean;
  /** Vrai seulement après conversion locale du document CR80, pas après un simple fichier de jetons. */
  printableConverted: boolean;
  operatorConfirmedSave: boolean;
  documentBytes: number | null;
  message: string | null;
  activatedCount: number | null;
  skippedActive: number | null;
}

export type BatchFlowAction =
  | { type: "reset"; classCode: string }
  | { type: "preflight_ok"; preflight: ClassCardPreflight }
  | { type: "failure"; failure: BatchFailure }
  | { type: "preparing" }
  | { type: "prepared"; view: PublicBatchView; secretsHeld: boolean; nonceHeld: boolean }
  | { type: "unusable"; view: PublicBatchView }
  | { type: "receiving" }
  | { type: "received"; view: PublicBatchView }
  | { type: "document_saved"; bytesWritten: number; printableConverted: boolean }
  | { type: "notice"; message: string }
  | { type: "operator_confirmed"; confirmed: boolean }
  | { type: "saving" }
  | { type: "saved"; view: PublicBatchView }
  | { type: "activating" }
  | { type: "activated"; view: PublicBatchView }
  | { type: "aborted"; view: PublicBatchView }
  | { type: "refreshed"; view: PublicBatchView }
  | { type: "response_lost" }
  | { type: "receipt_lost" }
  | { type: "save_lost" }
  | { type: "activation_lost" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canIssueClassStudentCards(ctx: PermissionContext): boolean {
  return getEntityFeaturePermissions(ctx, "students", "Élèves").canUpdate;
}

export function exclusionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Motif non précisé";
  const known = EXCLUSION_REASONS[reason];
  if (known) return known;
  if (reason.length > 80 || reason.includes(".")) return "Motif non précisé";
  return reason;
}

export function initialBatchFlow(classCode: string): BatchFlowState {
  return {
    classCode,
    phase: "preflight_loading",
    status: null,
    batchId: null,
    expiresAt: null,
    className: null,
    issueCandidates: 0,
    alreadyActive: 0,
    ineligible: 0,
    entries: [],
    publicIds: [],
    secretsRecoverable: false,
    secretsHeld: false,
    nonceHeld: false,
    documentSaveVerified: false,
    printableConverted: false,
    operatorConfirmedSave: false,
    documentBytes: null,
    message: null,
    activatedCount: null,
    skippedActive: null,
  };
}

/** Aucun appel automatique : une coupure ne relance jamais la préparation ni l'activation. */
export function automaticBatchCalls(): readonly never[] {
  return [];
}

export function explicitPrepareAllowed(state: BatchFlowState): boolean {
  if (state.phase === "preflight" && state.issueCandidates > 0) return true;
  if (state.phase === "response_lost" || state.phase === "aborted" || state.phase === "expired") return true;
  return false;
}

export function canConfirmDocumentSave(state: BatchFlowState): boolean {
  return (
    (state.phase === "awaiting_save" || state.phase === "save_lost") &&
    state.documentSaveVerified &&
    state.printableConverted &&
    state.operatorConfirmedSave &&
    state.secretsHeld
  );
}

export function canActivateBatch(state: BatchFlowState): boolean {
  return (
    (state.phase === "awaiting_activation" || state.phase === "activation_lost") &&
    state.documentSaveVerified &&
    state.printableConverted &&
    state.operatorConfirmedSave &&
    state.secretsHeld &&
    state.status === "saved"
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function toPublicBatchView(raw: unknown): PublicBatchView {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const countsRaw = source.counts && typeof source.counts === "object" ? (source.counts as Record<string, unknown>) : {};
  const entries = Array.isArray(source.entries) ? source.entries.map(toPublicEntry) : [];
  return {
    batchId: text(source.batchId),
    classCode: text(source.classCode),
    className: text(source.className),
    status: text(source.status) ?? "unknown",
    expiresAt: text(source.expiresAt),
    receivedAt: text(source.receivedAt),
    savedAt: text(source.savedAt),
    activatedAt: text(source.activatedAt),
    secretsIncluded: false,
    secretsRecoverable: false,
    counts: {
      prepared: numberCount(countsRaw.prepared),
      alreadyActive: numberCount(countsRaw.alreadyActive),
      ineligible: numberCount(countsRaw.ineligible),
      activated: numberCount(countsRaw.activated),
      skippedActive: numberCount(countsRaw.skippedActive),
      voided: numberCount(countsRaw.voided),
    },
    entries,
  };
}

function toPublicEntry(raw: unknown): PublicBatchEntry {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    studentId: text(row.studentId) ?? "",
    decision: text(row.decision) ?? text(row.outcome) ?? "other",
    reason: text(row.reason),
    publicId: text(row.publicId),
    outcome: text(row.outcome),
    cardStatus: text(row.cardStatus),
    scannable: row.scannable === true,
  };
}

export function splitCardToken(cardToken: string, expectedPublicId: string): { publicId: string; secret: string } | null {
  if (!cardToken || cardToken.length > 256 || cardToken !== cardToken.trim()) return null;
  const dot = cardToken.indexOf(".");
  if (dot <= 0 || dot !== cardToken.lastIndexOf(".") || dot === cardToken.length - 1) return null;
  const publicId = cardToken.slice(0, dot);
  const secret = cardToken.slice(dot + 1);
  if (publicId !== expectedPublicId || publicId.length > 200 || secret.length > 200) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(publicId) || !/^[A-Za-z0-9_-]+$/.test(secret)) return null;
  return { publicId, secret };
}

export function splitPreparePayload(raw: unknown): PrepareSplit {
  const view = toPublicBatchView(raw);
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (source.secretsIncluded !== true) {
    return { ok: true, view, nonce: null, secrets: [] };
  }
  const nonce = text(source.deliveryNonce);
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const secrets: PreparedCardSecret[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (row.decision !== "prepared") continue;
    const studentId = text(row.studentId);
    const publicId = text(row.publicId);
    const cardToken = text(row.cardToken);
    const parsed = studentId && publicId && cardToken ? splitCardToken(cardToken, publicId) : null;
    if (!studentId || !publicId || !cardToken || !parsed) return { ok: false, view, nonce: null, secrets: [] };
    secrets.push({ studentId, publicId, cardToken, secret: parsed.secret });
  }
  if (!nonce || secrets.length === 0) return { ok: false, view, nonce: null, secrets: [] };
  return { ok: true, view, nonce, secrets };
}

export function proofsFromSecrets(secrets: readonly PreparedCardSecret[]): Array<{ publicId: string; secret: string }> {
  return secrets.map((card) => ({ publicId: card.publicId, secret: card.secret }));
}

export function readPendingBatch(details: unknown): PendingBatch | null {
  if (!details || typeof details !== "object") return null;
  const row = details as Record<string, unknown>;
  const batchId = text(row.batchId) ?? "";
  if (!UUID_RE.test(batchId)) return null;
  const publicIds = Array.isArray(row.publicIds)
    ? row.publicIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200 && !id.includes("."),
      )
    : [];
  return {
    batchId,
    status: text(row.status) ?? "prepared",
    classCode: text(row.classCode) ?? "",
    expiresAt: text(row.expiresAt),
    publicIds,
    secretsRecoverable: false,
  };
}

export function classifyBatchError(error: unknown): BatchFailure {
  if (!(error instanceof ApiError)) {
    return { kind: "lost", message: BATCH_LOST_RESPONSE_MESSAGE, pending: null };
  }
  const pending = error.code === "STUDENT_CARD_BATCH_PENDING" ? readPendingBatch(error.details) : null;
  switch (error.code) {
    case "STUDENT_CARD_BATCH_PENDING":
      return {
        kind: "pending",
        message:
          "Un lot est déjà ouvert. Les secrets précédents ne sont pas récupérables. Abandonnez-le avant une nouvelle préparation.",
        pending,
      };
    case "STUDENT_CARD_BATCH_EXPIRED":
      return {
        kind: "expired",
        message:
          "Le lot a expiré. Les QR non activés ne seront jamais activés. Une nouvelle préparation n'est lancée que si vous la demandez.",
        pending: null,
      };
    case "STUDENT_CARD_BATCH_RECEIPT_REQUIRED":
      return {
        kind: "receipt_required",
        message: "L'accusé technique du message n'est pas enregistré. La sauvegarde du document ne le remplace pas.",
        pending: null,
      };
    case "STUDENT_CARD_BATCH_SAVE_REQUIRED":
      return {
        kind: "save_required",
        message: "L'activation exige la confirmation de sauvegarde du document, pas seulement l'aperçu.",
        pending: null,
      };
    case "STUDENT_CARD_BATCH_PROOF_INVALID":
      return {
        kind: "proof",
        message: "La preuve de possession du lot a été refusée. Les cartes ne sont pas activées.",
        pending: null,
      };
    case "STUDENT_CARD_BATCH_ACTIVATED":
      return {
        kind: "activated",
        message: "Ce lot est déjà activé. Les cartes actives ne sont pas remplacées.",
        pending: null,
      };
    case "STUDENT_CARD_QR_DISABLED":
      return { kind: "qr_disabled", message: "Les cartes QR sont désactivées pour cet établissement.", pending: null };
    case "STUDENT_CARD_DISABLED":
      return { kind: "disabled", message: "Les cartes élèves sont désactivées pour cet établissement.", pending: null };
    case "STUDENT_CARD_TENANT_DENIED":
      return { kind: "denied", message: "Périmètre établissement refusé.", pending: null };
    case "PLATFORM_PERSONAL_DATA_DENIED":
      return {
        kind: "denied",
        message: "Un administrateur plateforme ne peut pas émettre les cartes d'un établissement.",
        pending: null,
      };
    case "PERMISSION_DENIED":
      return {
        kind: "denied",
        message: "Vous n'avez pas le droit d'émettre les cartes de cet établissement.",
        pending: null,
      };
    case "STUDENT_CARD_CLASS_NOT_FOUND":
    case "STUDENT_CARD_BATCH_NOT_FOUND":
      return {
        kind: "not_found",
        message: "Introuvable pour l'établissement courant.",
        pending: null,
      };
    default:
      break;
  }
  if (error.status === 401 || error.status === 403) {
    return { kind: "denied", message: "Accès refusé pour cet établissement.", pending: null };
  }
  if (error.status === 404) {
    return { kind: "not_found", message: "Introuvable pour l'établissement courant.", pending: null };
  }
  if (error.status === 0 || error.status >= 500) {
    return { kind: "lost", message: BATCH_LOST_RESPONSE_MESSAGE, pending: null };
  }
  return { kind: "rejected", message: "La demande a été refusée.", pending: null };
}

function applyView(state: BatchFlowState, view: PublicBatchView, patch: Partial<BatchFlowState>): BatchFlowState {
  return {
    ...state,
    ...patch,
    batchId: view.batchId,
    status: view.status,
    expiresAt: view.expiresAt,
    className: view.className ?? state.className,
    entries: view.entries,
    publicIds: view.entries.map((entry) => entry.publicId).filter((id): id is string => Boolean(id)),
    secretsRecoverable: false,
    activatedCount: view.counts.activated ?? state.activatedCount,
    skippedActive: view.counts.skippedActive ?? state.skippedActive,
    message: patch.message === undefined ? null : patch.message,
  };
}

function clearPrivate(state: BatchFlowState, patch: Partial<BatchFlowState>): BatchFlowState {
  return {
    ...state,
    ...patch,
    secretsHeld: false,
    nonceHeld: false,
    documentSaveVerified: false,
    printableConverted: false,
    operatorConfirmedSave: false,
    documentBytes: null,
    secretsRecoverable: false,
  };
}

export function reduceBatchFlow(state: BatchFlowState, action: BatchFlowAction): BatchFlowState {
  switch (action.type) {
    case "reset":
      return initialBatchFlow(action.classCode);
    case "preflight_ok": {
      const empty = action.preflight.counts.issueCandidates === 0;
      return {
        ...initialBatchFlow(state.classCode),
        phase: empty ? "not_prepared" : "preflight",
        className: action.preflight.className,
        issueCandidates: action.preflight.counts.issueCandidates,
        alreadyActive: action.preflight.counts.alreadyActive,
        ineligible: action.preflight.counts.ineligible,
        entries: action.preflight.entries.map((entry) => ({
          studentId: entry.studentId,
          decision: entry.decision,
          reason: entry.reason,
          publicId: null,
          outcome: null,
          cardStatus: null,
          scannable: entry.decision === "already_active",
        })),
        message: empty ? "Aucun élève éligible. Aucune carte n'est préparée." : null,
      };
    }
    case "preparing":
      return { ...state, phase: "preparing", message: null };
    case "prepared":
      return applyView(state, action.view, {
        phase: "receiving",
        secretsHeld: action.secretsHeld,
        nonceHeld: action.nonceHeld,
        issueCandidates: action.view.counts.prepared ?? state.issueCandidates,
        alreadyActive: action.view.counts.alreadyActive ?? state.alreadyActive,
        ineligible: action.view.counts.ineligible ?? state.ineligible,
      });
    case "unusable":
      return clearPrivate(applyView(state, action.view, { phase: "unusable" }), {
        phase: "unusable",
        message:
          "La préparation est inexploitable. Les secrets ne sont pas conservés. Abandonnez le lot avant toute nouvelle demande.",
      });
    case "receiving":
      return { ...state, phase: "receiving", message: null };
    case "received":
      return applyView(state, action.view, {
        phase: "awaiting_save",
        secretsHeld: state.secretsHeld,
        nonceHeld: state.nonceHeld,
      });
    case "document_saved": {
      const printableConverted = action.printableConverted && action.bytesWritten > 0;
      return {
        ...state,
        documentSaveVerified: printableConverted,
        printableConverted,
        documentBytes: printableConverted ? action.bytesWritten : null,
        message: printableConverted
          ? null
          : "Un fichier de jetons ne permet pas d'activer les cartes. Le document CR80 est requis.",
      };
    }
    case "notice":
      return { ...state, message: action.message };
    case "operator_confirmed":
      return { ...state, operatorConfirmedSave: action.confirmed };
    case "saving":
      return { ...state, phase: "saving", message: null };
    case "saved":
      return applyView(state, action.view, {
        phase: action.view.status === "saved" ? "awaiting_activation" : state.phase,
        secretsHeld: state.secretsHeld,
        nonceHeld: false,
        documentSaveVerified: state.documentSaveVerified,
        printableConverted: state.printableConverted,
        operatorConfirmedSave: state.operatorConfirmedSave,
        documentBytes: state.documentBytes,
      });
    case "response_lost":
      return clearPrivate(state, { phase: "response_lost", message: BATCH_LOST_RESPONSE_MESSAGE });
    case "receipt_lost":
      return {
        ...state,
        phase: "receipt_lost",
        message: BATCH_LOST_RESPONSE_MESSAGE,
        secretsRecoverable: false,
      };
    case "save_lost":
      return { ...state, phase: "save_lost", message: BATCH_LOST_RESPONSE_MESSAGE, secretsRecoverable: false };
    case "activation_lost":
      return {
        ...state,
        phase: "activation_lost",
        message: BATCH_LOST_RESPONSE_MESSAGE,
        secretsRecoverable: false,
      };
    case "activating":
      return { ...state, phase: "activating", message: null };
    case "activated":
      return clearPrivate(
        applyView(state, action.view, {
          phase: "activated",
          activatedCount: action.view.counts.activated ?? 0,
          skippedActive: action.view.counts.skippedActive ?? 0,
        }),
        {
          phase: "activated",
          message:
            action.view.counts.skippedActive && action.view.counts.skippedActive > 0
              ? "Les cartes déjà actives ont été laissées intactes."
              : "Les cartes préparées sont actives.",
        },
      );
    case "aborted":
      return clearPrivate(applyView(state, action.view, { phase: "aborted" }), {
        phase: "aborted",
        entries: [],
        publicIds: [],
        message: "Le lot est abandonné. Les QR préparés ne seront pas activés.",
      });
    case "refreshed":
      if (action.view.status === "expired") {
        return clearPrivate(applyView(state, action.view, { phase: "expired" }), {
          phase: "expired",
          message:
            "Le lot a expiré. Les QR non activés ne seront jamais activés. Une nouvelle préparation n'est lancée que si vous la demandez.",
        });
      }
      if (action.view.status === "activated") {
        return clearPrivate(applyView(state, action.view, { phase: "activated" }), {
          phase: "activated",
          message: "Ce lot est déjà activé.",
        });
      }
      return applyView(state, action.view, {
        phase: state.phase,
        secretsHeld: state.secretsHeld,
        nonceHeld: state.nonceHeld,
        documentSaveVerified: state.documentSaveVerified,
        printableConverted: state.printableConverted,
        operatorConfirmedSave: state.operatorConfirmedSave,
        documentBytes: state.documentBytes,
      });
    case "failure":
      return applyFailure(state, action.failure);
    default:
      return state;
  }
}

function applyFailure(state: BatchFlowState, failure: BatchFailure): BatchFlowState {
  if (failure.kind === "pending") {
    const pending = failure.pending;
    return clearPrivate(state, {
      phase: "pending_blocked",
      batchId: pending?.batchId ?? state.batchId,
      status: pending?.status ?? "prepared",
      expiresAt: pending?.expiresAt ?? state.expiresAt,
      publicIds: pending?.publicIds ?? [],
      entries: [],
      message: failure.message,
    });
  }
  if (failure.kind === "expired") {
    return clearPrivate(state, { phase: "expired", entries: [], message: failure.message });
  }
  if (failure.kind === "lost") {
    if (state.phase === "preparing") {
      return clearPrivate(state, { phase: "response_lost", message: failure.message });
    }
    if (state.phase === "receiving" || state.phase === "receipt_lost") {
      return { ...state, phase: "receipt_lost", message: failure.message, secretsRecoverable: false };
    }
    if (state.phase === "saving" || state.phase === "save_lost") {
      return { ...state, phase: "save_lost", message: failure.message, secretsRecoverable: false };
    }
    if (state.phase === "activating" || state.phase === "activation_lost") {
      return { ...state, phase: "activation_lost", message: failure.message, secretsRecoverable: false };
    }
    return { ...state, phase: "error", message: failure.message, secretsRecoverable: false };
  }
  if (failure.kind === "denied" || failure.kind === "qr_disabled" || failure.kind === "disabled") {
    return clearPrivate(initialBatchFlow(state.classCode), {
      phase: "denied",
      entries: [],
      message: failure.message,
    });
  }
  if (failure.kind === "not_found") {
    return clearPrivate(initialBatchFlow(state.classCode), {
      phase: "not_found",
      entries: [],
      message: failure.message,
    });
  }
  if (failure.kind === "activated") {
    return clearPrivate(state, { phase: "activated", message: failure.message });
  }
  if (failure.kind === "save_required") {
    return { ...state, phase: "awaiting_save", message: failure.message, secretsRecoverable: false };
  }
  if (failure.kind === "receipt_required") {
    return {
      ...state,
      phase: state.nonceHeld ? "receipt_lost" : "error",
      message: failure.message,
      secretsRecoverable: false,
    };
  }
  if (failure.kind === "proof" || failure.kind === "rejected") {
    const phase =
      state.phase === "activating"
        ? "activation_lost"
        : state.phase === "saving"
          ? "save_lost"
          : state.phase === "receiving"
            ? "receipt_lost"
            : state.phase === "preparing"
              ? "error"
              : state.phase;
    return { ...state, phase, message: failure.message, secretsRecoverable: false };
  }
  return { ...state, message: failure.message, secretsRecoverable: false };
}

export interface DocumentSaveHandle {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

export interface DocumentSaveEnvironment {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<DocumentSaveHandle>;
  document?: Document;
}

export interface DocumentSaveResult {
  verified: boolean;
  bytesWritten: number;
  method: "file-picker" | "download" | null;
  cancelled: boolean;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function suggestedCardDocumentName(classCode: string): string {
  const safe = classCode.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 48);
  return `cartes-cr80-${safe || "classe"}.html`;
}

export async function saveStudentCardBatchDocument(
  textBody: string,
  filename: string,
  env: DocumentSaveEnvironment,
): Promise<DocumentSaveResult> {
  const bytesWritten = new TextEncoder().encode(textBody).length;
  if (bytesWritten === 0) return { verified: false, bytesWritten: 0, method: null, cancelled: false };
  if (env.showSaveFilePicker) {
    try {
      const handle = await env.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Cartes élèves CR80", accept: { "text/html": [".html"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(textBody);
      await writable.close();
      return { verified: true, bytesWritten, method: "file-picker", cancelled: false };
    } catch (error) {
      if (isAbortError(error)) return { verified: false, bytesWritten: 0, method: null, cancelled: true };
      throw error;
    }
  }
  const owner = env.document;
  if (!owner) return { verified: false, bytesWritten: 0, method: null, cancelled: false };
  const anchor = owner.createElement("a");
  const url = URL.createObjectURL(new Blob([textBody], { type: "text/html;charset=utf-8" }));
  anchor.href = url;
  anchor.download = filename;
  owner.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { verified: true, bytesWritten, method: "download", cancelled: false };
}
