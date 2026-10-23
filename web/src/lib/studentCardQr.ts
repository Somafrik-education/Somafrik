import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * CARTE-UI-01 — seule unité qui manipule le jeton de carte côté Web.
 *
 * Contenu du QR inchangé : exactement le cardToken, correction d'erreur « M ». Seules la marge et
 * la résolution d'impression changent :
 *  - margin: 4 → zone de silence de 4 modules incluse dans l'image (indépendante du CSS) ;
 *  - width: 640 px → environ 700 ppp une fois imprimé dans 23 mm.
 * Le jeton n'est ni stocké, ni journalisé, ni transmis à un autre composant : seule l'image
 * (data URL) est renvoyée, comme auparavant.
 */
export const STUDENT_CARD_QR_OPTIONS = Object.freeze({
  errorCorrectionLevel: "M",
  margin: 4,
  width: 640,
  color: { dark: "#000000", light: "#ffffff" },
} as const);

/** Zone de silence minimale exigée (en modules), vérifiée par les tests. */
export const STUDENT_CARD_QR_QUIET_ZONE_MODULES = 4;

export type StudentCardQrState = "idle" | "loading" | "ready" | "error";

export interface StudentCardQr {
  state: StudentCardQrState;
  src: string | null;
  retry: () => void;
}

/**
 * Génère l'image du QR pour l'aperçu et l'impression. `cardToken` null : aucune génération
 * (par exemple titulaire non déterminé).
 */
export function useStudentCardQr(cardToken: string | null): StudentCardQr {
  const [state, setState] = useState<StudentCardQrState>(cardToken ? "loading" : "idle");
  const [src, setSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!cardToken) {
      setState("idle");
      return () => {
        cancelled = true;
      };
    }
    setState("loading");
    void QRCode.toDataURL(cardToken, { ...STUDENT_CARD_QR_OPTIONS, color: { ...STUDENT_CARD_QR_OPTIONS.color } })
      .then((url) => {
        if (cancelled) return;
        setSrc(url);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSrc(null);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [cardToken, attempt]);

  return { state, src, retry: () => setAttempt((value) => value + 1) };
}
