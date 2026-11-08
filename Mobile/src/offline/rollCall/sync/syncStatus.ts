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
  correct: "Corriger l'appel",
  listTitle: "Appels hors connexion",
  empty: "Aucun appel hors connexion sur ce téléphone.",
  unconfirmableHint: "Le serveur refuse l'accès pour le moment. L'appel est conservé tel quel et sera renvoyé à l'identique.",
  conflictHint: "Un autre appel est déjà enregistré pour cette session. Contactez la direction : aucune correction automatique.",
  expiredHint: "Le délai de synchronisation (fin de J+3) est dépassé. Les présences doivent être saisies par la direction.",
} as const;

const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "Pas de connexion au serveur.",
  INTERRUPTED: "Envoi interrompu : il sera renvoyé à l'identique.",
  RESPONSE_UNREADABLE: "Réponse du serveur illisible.",
  ACK_MISMATCH: "Accusé de réception du serveur non conforme. L'appel est conservé ; contactez le support.",
  ACCOUNT_UNCONFIRMABLE: "Compte non reconnu par le serveur pour le moment.",
  ROLL_CALL_ROSTER_CHANGED: "La liste de la classe a changé depuis l'appel.",
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
};

export type SyncStatusView = {
  label: string;
  tone: "ok" | "neutral" | "warn" | "error";
  message: string | null;
  canSyncNow: boolean;
  canCorrect: boolean;
};

export function describeSyncStatus(row: SyncStatusInput, nowMs: number): SyncStatusView {
  const beforeDeadline = Date.parse(row.sync_deadline) > nowMs;
  const sendable = (row.state === "closed" || row.state === "failed_retryable" || row.state === "unconfirmable") && beforeDeadline;
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
      const at = row.next_attempt_at ? ` Prochaine tentative vers ${row.next_attempt_at.slice(11, 16)} UTC.` : "";
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
