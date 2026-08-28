import { useEffect, useState } from "react";
import { announcementsApi } from "./announcementsApi";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";

/**
 * Badge Annonces : compteur PostgreSQL (GET unread-count).
 * Le stockage navigateur n'est plus la source de vérité.
 */

export function useAnnouncementsUnreadCount(enabled: boolean, schoolCode?: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || !hasCommunicationSchoolScope(schoolCode)) {
      setCount(0);
      return;
    }
    let cancelled = false;
    void announcementsApi
      .unreadCount(schoolCode ?? undefined)
      .then((result) => {
        if (!cancelled) setCount(Number(result?.count) || 0);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, schoolCode]);
  return count;
}
