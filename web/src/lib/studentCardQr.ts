import { useEffect, useMemo, useState } from "react";
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
  // Request identity is unique per token transition, including A → B → A.
  // An old QR can never be reused when returning to a previously seen token.
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ token: cardToken, attempt }), [cardToken, attempt]);
  const [result, setResult] = useState<{
    request: typeof request;
    state: "ready" | "error";
    src: string | null;
  } | null>(null);

  useEffect(() => {
    if (!request.token) return;
    let cancelled = false;
    void QRCode.toDataURL(request.token, { ...STUDENT_CARD_QR_OPTIONS, color: { ...STUDENT_CARD_QR_OPTIONS.color } })
      .then((url) => {
        if (!cancelled) setResult({ request, state: "ready", src: url });
      })
      .catch(() => {
        if (!cancelled) setResult({ request, state: "error", src: null });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const current = result?.request === request ? result : null;
  return {
    state: !request.token ? "idle" : current?.state ?? "loading",
    src: current?.src ?? null,
    retry: () => setAttempt((value) => value + 1),
  };
}
