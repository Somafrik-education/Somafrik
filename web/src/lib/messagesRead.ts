import { useEffect, useState } from "react";
import { messagesApi } from "./messagesApi";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";

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
    void messagesApi
      .unreadCount(schoolScope ?? undefined)
      .then((result) => {
        if (!cancelled) setCount(Math.max(0, Number(result?.count) || 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, schoolScope]);
  return count;
}
