/**
 * NFC-PRES-LOCAL-PR4 — présentation des états de synchronisation (pure, testable).
 *
 * Règles d'action :
 *  - « Synchroniser maintenant » : seulement si `beginSyncAttempt` accepterait l'envoi
 *    (closed, failed_retryable, unconfirmable) et avant l'échéance ;
 *  - « Corriger l'appel » : seulement après une attestation serveur `not_recorded`
 *    (`failed_action_required` + `last_session_state = not_recorded`). Jamais après un timeout,
 *    une réponse perdue, un état non confirmable, un conflit ou un ACK contradictoire.
 */
import type { RcSessionState } from "../store/schema";

export const SYNC_COPY = {
  draft: "Brouillon local",
  closed: "À synchroniser",
  syncing: "Synchronisation en cours",
  synced: "Synchronisé",
  failed_retryable: "Nouvelle tentative prévue",
  unconfirmable: "État serveur non confirmable actuellement.",
  failed_action_required: "Échec à résoudre",
  expired: "Appel expiré",
  blocked_logout: "En attente de reconnexion",
  syncedSuccess: "Appel synchronisé avec succès.",
  syncNow: "Synchroniser maintenant",
  cooldown: "Tentative trop récente : réessayez dans quelques secondes.",
  correct: "Corriger l'appel",
  listTitle: "Appels hors connexion",
  empty: "Aucun appel hors connexion sur ce téléphone.",
  unconfirmableHint: "Le serveur refuse l'accès pour le moment. L'appel est conservé tel quel et sera renvoyé à l'identique.",
  conflictHint: "Un autre appel est déjà enregistré pour cette session. Contactez la direction : aucune correction automatique.",
  expiredHint: "Le délai de synchronisation (fin de J+3) est dépassé. Les présences doivent être saisies par la direction.",
} as const;

/**
 * NFC-APPEL-PARTIEL-01 — bandeau supérieur de l'écran d'appel, dérivé UNIQUEMENT de l'état stocké
 * de la session (jamais d'un message figé à la clôture) : « Synchronisé » n'apparaît qu'en `synced`,
 * c'est-à-dire après un ACK conforme enregistré par `recordSyncOutcome`.
 */
export const SYNC_BANNER = {
  closed: "Appel enregistré localement — à synchroniser",
  syncing: "Synchronisation en cours",
  failed_retryable: "Enregistré localement — nouvelle tentative prévue",
  unconfirmable: "État serveur non confirmable",
  failed_action_required: "Échec à résoudre",
  synced: "Appel synchronisé avec succès",
  expired: "Appel expiré — intervention nécessaire",
  blocked_logout: "Enregistré localement — en attente de reconnexion",
} as const;

export function syncBanner(state: RcSessionState): { message: string; tone: "ok" | "neutral" | "warn" | "error" } | null {
  switch (state) {
    case "closed":
    case "syncing":
    case "blocked_logout":
      return { message: SYNC_BANNER[state], tone: "neutral" };
    case "failed_retryable":
    case "unconfirmable":
      return { message: SYNC_BANNER[state], tone: "warn" };
    case "failed_action_required":
    case "expired":
      return { message: SYNC_BANNER[state], tone: "error" };
    case "synced":
      return { message: SYNC_BANNER.synced, tone: "ok" };
    default:
      return null;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "Pas de connexion au serveur.",
  INTERRUPTED: "Envoi interrompu : il sera renvoyé à l'identique.",
  RESPONSE_UNREADABLE: "Réponse du serveur illisible.",
  ACK_MISMATCH: "Accusé de réception du serveur non conforme. L'appel est conservé ; contactez le support.",
  ACCOUNT_UNCONFIRMABLE: "Compte non reconnu par le serveur pour le moment.",
  ROLL_CALL_ROSTER_CHANGED: "La liste de la classe a changé depuis l'appel (élève désinscrit ou appel enregistré avec l'ancienne règle des absences).",
  ROLL_CALL_CARD_INVALID: "Une carte n'est plus valide (révoquée, remplacée ou élève désinscrit).",
  ROLL_CALL_PROOF_INVALID: "Une lecture de carte n'a pas pu être vérifiée par le serveur.",
  ROLL_CALL_OFFLINE_EXPIRED: "Date hors de la fenêtre de synchronisation.",
  ROLL_CALL_OFFLINE_DISABLED: "L'appel hors connexion est désactivé pour l'établissement.",
  ROLL_CALL_OFFLINE_MEDIA_DISABLED: "Le support de lecture utilisé (NFC ou QR) est désactivé.",
  ROLL_CALL_CLASS_FORBIDDEN: "Vous n'êtes plus affecté à cette classe.",
  ROLL_CALL_SESSION_CONFLICT: "Conflit avec un appel déjà enregistré.",
  ROLL_CALL_REPLAY_FORBIDDEN: "Accès refusé par le serveur pour le moment.",
  STUDENT_CARD_DISABLED: "La carte élève est désactivée pour l'établissement.",
  STUDENT_CARD_ATTENDANCE_DISABLED: "Le pointage des présences par carte est désactivé.",
};

export function syncErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (/^HTTP_5\d\d$/.test(code)) return "Serveur momentanément indisponible.";
  if (code === "HTTP_408" || code === "HTTP_429") return "Serveur occupé : nouvelle tentative plus tard.";
  return "Le serveur a refusé l'appel.";
}

export type SyncStatusInput = {
  state: RcSessionState;
  last_session_state: "not_recorded" | "conflict" | null;
  last_error_code: string | null;
  sync_deadline: string;
  next_attempt_at: string | null;
  attempt_count: number;
  last_http_status?: number | null;
};

/**
 * Le bouton « Synchroniser maintenant » n'est proposé que si `listSyncCandidates` accepterait la
 * demande : tentative due, ou dernier échec sans réponse HTTP (backoff client). Une échéance
 * serveur (réponse HTTP reçue, dont Retry-After) n'est jamais contournable.
 */
export function manualSyncAllowed(row: Pick<SyncStatusInput, "next_attempt_at" | "last_http_status">, nowMs: number): boolean {
  const due = !row.next_attempt_at || Date.parse(row.next_attempt_at) <= nowMs;
  return due || row.last_http_status == null;
}

export type SyncStatusView = {
  label: string;
  tone: "ok" | "neutral" | "warn" | "error";
  message: string | null;
  canSyncNow: boolean;
  canCorrect: boolean;
};

export function describeSyncStatus(row: SyncStatusInput, nowMs: number): SyncStatusView {
  const beforeDeadline = Date.parse(row.sync_deadline) > nowMs;
  const sendable =
    (row.state === "closed" || row.state === "failed_retryable" || row.state === "unconfirmable") && beforeDeadline && manualSyncAllowed(row, nowMs);
  const error = syncErrorMessage(row.last_error_code);
  switch (row.state) {
    case "draft":
      return { label: SYNC_COPY.draft, tone: "neutral", message: null, canSyncNow: false, canCorrect: false };
    case "closed":
      return { label: SYNC_COPY.closed, tone: "neutral", message: null, canSyncNow: sendable, canCorrect: false };
    case "syncing":
      return { label: SYNC_COPY.syncing, tone: "neutral", message: null, canSyncNow: false, canCorrect: false };
    case "synced":
      return { label: SYNC_COPY.synced, tone: "ok", message: SYNC_COPY.syncedSuccess, canSyncNow: false, canCorrect: false };
    case "failed_retryable": {
      const serverDelay = row.last_http_status != null && !!row.next_attempt_at && Date.parse(row.next_attempt_at) > nowMs;
      const at = row.next_attempt_at
        ? ` Prochaine tentative vers ${row.next_attempt_at.slice(11, 16)} UTC${serverDelay ? " (délai demandé par le serveur)" : ""}.`
        : "";
      return { label: SYNC_COPY.failed_retryable, tone: "warn", message: `${error ?? ""}${at}`.trim() || null, canSyncNow: sendable, canCorrect: false };
    }
    case "unconfirmable":
      return { label: SYNC_COPY.unconfirmable, tone: "warn", message: SYNC_COPY.unconfirmableHint, canSyncNow: sendable, canCorrect: false };
    case "failed_action_required": {
      if (row.last_session_state === "not_recorded") {
        return { label: SYNC_COPY.failed_action_required, tone: "error", message: `${error ?? "Le serveur n'a pas enregistré l'appel."} Appel non enregistré par le serveur : corrigez-le puis clôturez-le de nouveau.`, canSyncNow: false, canCorrect: beforeDeadline };
      }
      if (row.last_session_state === "conflict") {
        return { label: SYNC_COPY.failed_action_required, tone: "error", message: SYNC_COPY.conflictHint, canSyncNow: false, canCorrect: false };
      }
      return { label: SYNC_COPY.failed_action_required, tone: "error", message: error, canSyncNow: false, canCorrect: false };
    }
    case "expired":
      return { label: SYNC_COPY.expired, tone: "error", message: SYNC_COPY.expiredHint, canSyncNow: false, canCorrect: false };
    case "blocked_logout":
      return { label: SYNC_COPY.blocked_logout, tone: "neutral", message: null, canSyncNow: false, canCorrect: false };
    default:
      return { label: String(row.state), tone: "neutral", message: null, canSyncNow: false, canCorrect: false };
  }
}
