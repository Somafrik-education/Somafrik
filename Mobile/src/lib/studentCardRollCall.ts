/**
 * CARTE-PR1 — appel collectif par carte (NFC / QR), logique pure.
 *
 * Le brouillon ne contient que des reçus opaques et des clés de déduplication
 * renvoyés par le serveur : aucune identité d'élève, aucun jeton de carte.
 * Il vit uniquement en mémoire ; rien n'est pointé avant « Valider l'appel ».
 */

export const COLLECTIVE_ROLL_CALL_COPY = {
  startNfc: "Appel collectif NFC",
  startQr: "Appel collectif QR",
  resume: "Reprendre l'appel",
  title: "Appel des élèves",
  counterLabel: "cartes scannées",
  instructionsNfc: "Présentez les cartes NFC successivement.",
  instructionsQr: "Présentez les QR codes successivement devant la caméra.",
  privacy: "Aucun nom d'élève n'est affiché pendant l'appel.",
  remaining: (count: number) => `${count} élève(s) non scanné(s)`,
  draft: "Brouillon — rien n'est enregistré avant validation.",
  undoLast: "Annuler le dernier",
  validate: (count: number) => `Valider l'appel (${count})`,
  validating: "Validation en cours…",
  close: "Fermer (garder le brouillon)",
  abandon: "Abandonner l'appel",
  abandonConfirmTitle: "Abandonner l'appel ?",
  abandonConfirmBody: "Les cartes scannées seront oubliées. Aucune présence n'a été enregistrée.",
  abandonConfirm: "Abandonner",
  keep: "Continuer l'appel",
  accepted: "Carte acceptée.",
  duplicate: "Carte déjà scannée.",
  undone: "Dernier scan annulé.",
  refusedClass: "Carte d'un élève d'une autre classe.",
  refusedCard: "Carte refusée : inconnue, remplacée, perdue ou révoquée.",
  notSomafrik: "Cette carte n'est pas une carte élève Somafrik.",
  forbidden: "Cette classe n'est pas dans votre périmètre d'appel.",
  offline: "Connexion indisponible : la carte n'a pas été comptée.",
  timeout: "Réseau lent : présentez de nouveau la carte.",
  scanFailed: "La carte n'a pas pu être vérifiée. Présentez-la de nouveau.",
  nfcUnavailable: "NFC indisponible ou désactivé sur cet appareil.",
  validated: (count: number) => `Appel validé : ${count} présence(s) enregistrée(s).`,
  cardsInvalid: (count: number) =>
    `${count} scan(s) retiré(s) : carte devenue invalide. Vérifiez le compteur puis validez à nouveau.`,
  expired: "Les scans ont expiré : recommencez l'appel.",
  validateFailed: "L'appel n'a pas été enregistré. Réessayez.",
  emptyDraft: "Scannez au moins une carte avant de valider.",
} as const;

export type RollCallContext = {
  scopeKey: string;
  sessionId: string;
  classId: string;
  date: string;
};

export type RollCallEntry = { dedupKey: string; receipt: string };

export type RollCallDraft = RollCallContext & {
  entries: RollCallEntry[];
};

export type RollCallFeedback = {
  kind: "accepted" | "duplicate" | "refused" | "info" | "error";
  message: string;
};

export function rollCallScopeKey(input: {
  resourceScopeKey?: string;
  schoolCode?: string;
  classId?: string;
  date?: string;
}): string {
  return [input.resourceScopeKey, input.schoolCode, input.classId, input.date]
    .map((part) => String(part ?? "").trim())
    .join("|");
}

export function createRollCallDraft(context: RollCallContext): RollCallDraft {
  return { ...context, entries: [] };
}

/** Le compteur suit les élèves distincts : rescanner la même carte ne le fait pas avancer. */
export function addRollCallScan(
  draft: RollCallDraft,
  scan: RollCallEntry,
): { draft: RollCallDraft; feedback: RollCallFeedback } {
  if (draft.entries.some((entry) => entry.dedupKey === scan.dedupKey)) {
    return { draft, feedback: { kind: "duplicate", message: COLLECTIVE_ROLL_CALL_COPY.duplicate } };
  }
  return {
    draft: { ...draft, entries: [...draft.entries, { dedupKey: scan.dedupKey, receipt: scan.receipt }] },
    feedback: { kind: "accepted", message: COLLECTIVE_ROLL_CALL_COPY.accepted },
  };
}

export function undoLastRollCallScan(draft: RollCallDraft): RollCallDraft {
  if (draft.entries.length === 0) return draft;
  return { ...draft, entries: draft.entries.slice(0, -1) };
}

export function removeRollCallReceipts(draft: RollCallDraft, indexes: readonly number[]): RollCallDraft {
  const drop = new Set(indexes);
  return { ...draft, entries: draft.entries.filter((_entry, index) => !drop.has(index)) };
}

export function rollCallProgress(draft: RollCallDraft | null, rosterSize: number) {
  const count = draft?.entries.length ?? 0;
  const total = Math.max(0, Math.floor(rosterSize));
  const percent = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
  return { count, total, percent, remaining: Math.max(0, total - count) };
}

export function rollCallValidateBody(draft: RollCallDraft, teacherId?: string) {
  return {
    sessionId: draft.sessionId,
    classId: draft.classId,
    date: draft.date,
    receipts: draft.entries.map((entry) => entry.receipt),
    ...(teacherId ? { teacherId } : {}),
  };
}

type ApiErrorLike = { status?: number; code?: string; details?: unknown; message?: string };

function asApiError(error: unknown): ApiErrorLike {
  return error && typeof error === "object" ? (error as ApiErrorLike) : {};
}

/** Message de refus d'un scan : jamais d'identité, et l'arrêt de la boucle si la classe est hors périmètre. */
export function rollCallScanFailure(error: unknown): { feedback: RollCallFeedback; stop: boolean } {
  const { status, code } = asApiError(error);
  if (code === "ROLL_CALL_CLASS_MISMATCH") {
    return { feedback: { kind: "refused", message: COLLECTIVE_ROLL_CALL_COPY.refusedClass }, stop: false };
  }
  if (code === "ROLL_CALL_CLASS_FORBIDDEN" || status === 401 || status === 403) {
    return { feedback: { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.forbidden }, stop: true };
  }
  if (status === 404 || status === 409 || code === "STUDENT_CARD_NOT_FOUND" || code === "STUDENT_CARD_INVALID_STATE") {
    return { feedback: { kind: "refused", message: COLLECTIVE_ROLL_CALL_COPY.refusedCard }, stop: false };
  }
  if (status === 400) {
    return { feedback: { kind: "refused", message: COLLECTIVE_ROLL_CALL_COPY.notSomafrik }, stop: false };
  }
  if (code === "NETWORK_UNAVAILABLE" || status === 0) {
    return { feedback: { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.offline }, stop: false };
  }
  if (code === "TIMEOUT") {
    return { feedback: { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.timeout }, stop: false };
  }
  return { feedback: { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.scanFailed }, stop: false };
}

export type RollCallValidationOutcome =
  | { kind: "validated"; recorded: number; message: string }
  | { kind: "cards_invalid"; draft: RollCallDraft; message: string }
  | { kind: "expired"; message: string }
  | { kind: "error"; message: string };

export async function validateRollCallDraft(
  draft: RollCallDraft,
  deps: {
    teacherId?: string;
    validate: (
      body: ReturnType<typeof rollCallValidateBody>,
      options: { idempotencyKey: string },
    ) => Promise<{ recorded?: number }>;
  },
): Promise<RollCallValidationOutcome> {
  if (draft.entries.length === 0) return { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.emptyDraft };
  try {
    // Identifiant d'opération stable : la session. Un nouvel essai après coupure réseau
    // rejoue la même opération côté serveur, sans doublon.
    const result = await deps.validate(rollCallValidateBody(draft, deps.teacherId), {
      idempotencyKey: draft.sessionId,
    });
    const recorded = Number(result?.recorded ?? draft.entries.length);
    return { kind: "validated", recorded, message: COLLECTIVE_ROLL_CALL_COPY.validated(recorded) };
  } catch (error) {
    const { code, details } = asApiError(error);
    if (code === "ROLL_CALL_CARD_INVALID") {
      const indexes = (details as { invalidReceiptIndexes?: unknown })?.invalidReceiptIndexes;
      const valid = Array.isArray(indexes) ? indexes.filter((value): value is number => Number.isInteger(value)) : [];
      const next = removeRollCallReceipts(draft, valid);
      return { kind: "cards_invalid", draft: next, message: COLLECTIVE_ROLL_CALL_COPY.cardsInvalid(draft.entries.length - next.entries.length) };
    }
    if (code === "ROLL_CALL_RECEIPT_EXPIRED" || code === "ROLL_CALL_RECEIPT_INVALID" || code === "ROLL_CALL_CONTEXT_MISMATCH") {
      return { kind: "expired", message: COLLECTIVE_ROLL_CALL_COPY.expired };
    }
    return { kind: "error", message: rollCallScanFailure(error).feedback.message === COLLECTIVE_ROLL_CALL_COPY.offline
      ? COLLECTIVE_ROLL_CALL_COPY.offline
      : COLLECTIVE_ROLL_CALL_COPY.validateFailed };
  }
}

export type NfcReadLike =
  | { ok: true; token: string }
  | { ok: false; reason: string };

/**
 * Boucle NFC de l'appel collectif : une seule lecture à la fois, réarmement automatique
 * après chaque carte, arrêt immédiat et définitif sur stop().
 */
export function createRollCallNfcLoop(deps: {
  read: () => Promise<NfcReadLike>;
  submit: (token: string) => Promise<{ stop: boolean }>;
  onFeedback: (feedback: RollCallFeedback) => void;
  onListening: (listening: boolean) => void;
}) {
  let generation = 0;
  let activeRun = 0;

  async function run(own: number) {
    activeRun = own;
    deps.onListening(true);
    try {
      while (own === generation) {
        const read = await deps.read();
        if (own !== generation) return;
        if (read.ok) {
          const { stop } = await deps.submit(read.token);
          if (stop) return;
          continue;
        }
        if (read.reason === "timeout") continue;
        if (read.reason === "cancelled") return;
        if (read.reason === "unsupported" || read.reason === "disabled") {
          deps.onFeedback({ kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.nfcUnavailable });
          return;
        }
        deps.onFeedback(read.reason === "error"
          ? { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.scanFailed }
          : { kind: "refused", message: COLLECTIVE_ROLL_CALL_COPY.notSomafrik });
      }
    } finally {
      if (activeRun === own) deps.onListening(false);
    }
  }

  return {
    start() {
      generation += 1;
      void run(generation);
    },
    stop() {
      generation += 1;
      activeRun = 0;
      deps.onListening(false);
    },
  };
}
