import { ApiError } from "../api/client";

/** Code serveur du verrou plateforme NFC (GO-PROD-G6-02 / #921). */
export const NFC_NOT_HOMOLOGATED_CODE = "STUDENT_CARD_NFC_NOT_HOMOLOGATED";

/**
 * PROD-V25-POSTSMOKE-01 — message exploitable : jamais un « refusé » générique.
 * Le message serveur est conservé, avec le statut HTTP et le code d'erreur.
 */
export function studentCardSaveErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Enregistrement impossible : serveur injoignable. Vérifiez la connexion puis réessayez.";
  }
  if (error.code === NFC_NOT_HOMOLOGATED_CODE) {
    return "Le NFC n’est pas encore homologué : il reste désactivé sur cette plateforme. Les autres paramètres n’ont pas été enregistrés ; ils peuvent l’être sans le NFC.";
  }
  if (error.status === 403) {
    return `Enregistrement refusé : droits insuffisants pour modifier les paramètres de l’établissement (HTTP 403${error.code ? `, ${error.code}` : ""}).`;
  }
  const reason = String(error.message ?? "").trim() || "motif non précisé par le serveur";
  return `Enregistrement refusé : ${reason} (HTTP ${error.status}${error.code ? `, ${error.code}` : ""}).`;
}
