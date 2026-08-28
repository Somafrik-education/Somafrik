import { useEffect, useState } from "react";
import { getAnnouncementsUnreadCount } from "../services/api";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";

/**
 * Badge Annonces : compteur PostgreSQL.
 * Aucun stockage navigateur / mémoire session comme SoT.
 */

export function useAnnouncementsUnreadCount(
  enabled: boolean,
  schoolCode?: string | null,
): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || !hasCommunicationSchoolScope(schoolCode)) {
      setCount(0);
      return;
    }
    let cancelled = false;
    void getAnnouncementsUnreadCount(schoolCode ?? undefined)
      .then((value) => {
        if (!cancelled) setCount(value);
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
