/**
 * NFC-ROLES-ACCESS-01 — actions de carte de l'écran Présences, SANS classe ouverte.
 *
 * Chaque action dépend de SA permission (le serveur reste seul juge) :
 *  1. « Vérifier une carte »  : route POST /api/student-cards/verify
 *     (Élèves:READ, Voir élèves, Gérer élèves, Présences:CREATE ou Présences:UPDATE) ;
 *  2. « Démarrer l'appel NFC/QR » : droit dédié « Présences — Effectuer l'appel (NFC/QR) » +
 *     appel hors connexion activé pour l'établissement ;
 *  3. « Vérifier les appels » : même droit (appels locaux du compte uniquement).
 * Supports : NFC sur Android si le pointage NFC est activé, QR si le pointage carte est activé.
 */
import { resolveCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import {
  isStudentCardAttendanceScanEnabled,
  isStudentCardNfcAttendanceScanEnabled,
  isStudentCardOfflineRollCallEnabled,
  type StudentCardScanSettings,
} from "./studentCardScan";
import type { RollCallActor } from "./studentCardRollCallRoles";

export const CARD_VERIFY_PERMISSIONS = Object.freeze(["Élèves:READ", "Voir élèves", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"]);

export type RollCallLauncher = {
  nfcAvailable: boolean;
  qrAvailable: boolean;
  canVerifyCard: boolean;
  canStartRollCall: boolean;
  canCheckCalls: boolean;
};

export function resolveRollCallLauncher(args: {
  session: unknown;
  actor: RollCallActor;
  settings: StudentCardScanSettings | null | undefined;
  platformOs: string;
  /** Une base d'appel est déjà ouverte pour ce compte (appels en attente consultables). */
  hasLocalRollCallStore?: boolean;
}): RollCallLauncher {
  const mobile = args.platformOs === "android" || args.platformOs === "ios";
  const nfcAvailable = args.platformOs === "android" && isStudentCardNfcAttendanceScanEnabled(args.settings);
  const qrAvailable = mobile && isStudentCardAttendanceScanEnabled(args.settings);
  const permissions = new Set(resolveCanonicalRoleIdentity(args.session).permissions);
  const offlineEnabled = isStudentCardOfflineRollCallEnabled(args.settings);
  return {
    nfcAvailable,
    qrAvailable,
    canVerifyCard: args.actor.verify && (nfcAvailable || qrAvailable) && CARD_VERIFY_PERMISSIONS.some((p) => permissions.has(p)),
    canStartRollCall: args.actor.rollCall && mobile && offlineEnabled && (nfcAvailable || qrAvailable),
    canCheckCalls: args.actor.rollCall && mobile && (offlineEnabled || Boolean(args.hasLocalRollCallStore)),
  };
}
