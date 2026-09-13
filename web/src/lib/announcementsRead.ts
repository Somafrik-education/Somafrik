import { useEffect, useState } from "react";
import { announcementsApi } from "./announcementsApi";
import { platformAnnouncementsApi } from "./platformAnnouncementsApi";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";

export const ANNOUNCEMENTS_UNREAD_CHANGED_EVENT = "somafrik:announcements-unread-changed";

export function notifyAnnouncementsUnreadChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ANNOUNCEMENTS_UNREAD_CHANGED_EVENT));
}

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

    async function refresh() {
      try {
        const [school, platform] = await Promise.all([
          schoolScope ? announcementsApi.unreadCount(schoolScope) : Promise.resolve({ count: 0 }),
          platformAnnouncementsApi.unreadCount(),
        ]);
        if (!cancelled) setCount((Number(school?.count) || 0) + (Number(platform?.count) || 0));
      } catch {
        if (!cancelled) setCount(0);
      }
    }

    void refresh();
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener(ANNOUNCEMENTS_UNREAD_CHANGED_EVENT, onChanged);
    window.addEventListener("focus", onChanged);
    document.addEventListener("visibilitychange", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(ANNOUNCEMENTS_UNREAD_CHANGED_EVENT, onChanged);
      window.removeEventListener("focus", onChanged);
      document.removeEventListener("visibilitychange", onChanged);
    };
  }, [enabled, schoolScope]);
  return count;
}
