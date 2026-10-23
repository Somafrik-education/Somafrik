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
  // Each result is bound to its request. A render with another token can never
  // expose the previous QR, even before the cleanup effect runs.
  const [result, setResult] = useState<{
    token: string;
    attempt: number;
    state: "ready" | "error";
    src: string | null;
  } | null>(null);
  const [request, setRequest] = useState<{ token: string | null; attempt: number }>({
    token: cardToken,
    attempt: 0,
  });
  const attempt = request.token === cardToken ? request.attempt : 0;

  useEffect(() => {
    if (!cardToken) return;
    let cancelled = false;
    void QRCode.toDataURL(cardToken, { ...STUDENT_CARD_QR_OPTIONS, color: { ...STUDENT_CARD_QR_OPTIONS.color } })
      .then((url) => {
        if (!cancelled) setResult({ token: cardToken, attempt, state: "ready", src: url });
      })
      .catch(() => {
        if (!cancelled) setResult({ token: cardToken, attempt, state: "error", src: null });
      });
    return () => {
      cancelled = true;
    };
  }, [cardToken, attempt]);

  const current = result?.token === cardToken && result.attempt === attempt ? result : null;
  return {
    state: !cardToken ? "idle" : current?.state ?? "loading",
    src: current?.src ?? null,
    retry: () => setRequest((prev) => ({
      token: cardToken,
      attempt: prev.token === cardToken ? prev.attempt + 1 : 1,
    })),
  };
}
