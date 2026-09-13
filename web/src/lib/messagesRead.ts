import { useEffect, useState } from "react";
import { messagesApi } from "./messagesApi";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";

export const MESSAGES_UNREAD_CHANGED_EVENT = "somafrik:messages-unread-changed";

export function notifyMessagesUnreadChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MESSAGES_UNREAD_CHANGED_EVENT));
}

/**
 * Badge Messages : compteur PostgreSQL (GET unread-count).
 * Aucun snapshot BackOffice / DataContext comme source de vérité.
 */
export function useMessagesUnreadCount(enabled: boolean, schoolCode?: string | null): number {
  const [count, setCount] = useState(0);
  const schoolScope = hasCommunicationSchoolScope(schoolCode) ? schoolCode : undefined;
  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;

    async function refresh() {
      try {
        const result = await messagesApi.unreadCount(schoolScope ?? undefined);
        if (!cancelled) setCount(Math.max(0, Number(result?.count) || 0));
      } catch {
        /* erreur transport : conserver la dernière valeur connue, jamais un zéro métier */
      }
    }

    void refresh();
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener(MESSAGES_UNREAD_CHANGED_EVENT, onChanged);
    window.addEventListener("focus", onChanged);
    document.addEventListener("visibilitychange", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(MESSAGES_UNREAD_CHANGED_EVENT, onChanged);
      window.removeEventListener("focus", onChanged);
      document.removeEventListener("visibilitychange", onChanged);
    };
  }, [enabled, schoolScope]);
  return count;
}
