import { useEffect, useState } from "react";
import { announcementsApi } from "./announcementsApi";
import { platformAnnouncementsApi } from "./platformAnnouncementsApi";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";

/**
 * Badge Annonces : compteur PostgreSQL (GET unread-count).
 * Le stockage navigateur n'est plus la source de vérité.
 * C3 établissement + plateforme Superadmin agrégés.
 */

export function useAnnouncementsUnreadCount(enabled: boolean, schoolCode?: string | null): number {
  const [count, setCount] = useState(0);
  const schoolScope = hasCommunicationSchoolScope(schoolCode) ? schoolCode : undefined;
  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    void Promise.all([
      schoolScope ? announcementsApi.unreadCount(schoolScope) : Promise.resolve({ count: 0 }),
      platformAnnouncementsApi.unreadCount(),
    ])
      .then(([school, platform]) => {
        if (!cancelled) setCount((Number(school?.count) || 0) + (Number(platform?.count) || 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, schoolScope]);
  return count;
}
