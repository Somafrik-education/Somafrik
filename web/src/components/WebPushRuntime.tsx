import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { InlineAlert } from "../design-system";
import { syncWebPushSubscription, type WebPushSyncStatus } from "../lib/webPushPermission";

export type WebPushRuntimeStatus = WebPushSyncStatus | "idle" | "error";

/**
 * Synchronise l'abonnement Web Push après authentification.
 * Permission denied = état normal (pas d'alerte).
 * Un échec technique est visible et relançable, sans secret.
 */
export function WebPushRuntime() {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<WebPushRuntimeStatus>("idle");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await syncWebPushSubscription();
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, attempt]);

  const retry = useCallback(() => {
    setStatus("idle");
    setAttempt((current) => current + 1);
  }, []);

  if (!isAuthenticated || status !== "error") return null;

  return (
    <InlineAlert
      tone="warning"
      title="Notifications navigateur"
      action={
        <button type="button" onClick={retry}>
          Réessayer
        </button>
      }
    >
      Les notifications navigateur n&apos;ont pas pu être activées.
    </InlineAlert>
  );
}
