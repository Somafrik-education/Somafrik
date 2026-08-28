import { useEffect, useState } from "react";
import { internalNotificationsApi } from "./internalNotificationsApi";

export const INTERNAL_NOTIFICATIONS_CHANGED_EVENT = "somafrik:internal-notifications-changed";

export function notifyInternalNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INTERNAL_NOTIFICATIONS_CHANGED_EVENT));
}

/**
 * Badge Notifications internes : compteur PostgreSQL (GET unread-count).
 * Aucune source de vérité navigateur ni snapshot BackOffice.
 */
export function useInternalNotificationsUnreadCount(enabled: boolean, schoolCode?: string | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setCount(0);
      return () => {
        cancelled = true;
      };
    }

    async function refresh() {
      try {
        const result = await internalNotificationsApi.unreadCount(schoolCode ?? undefined);
        if (!cancelled) setCount(Math.max(0, Number(result.count) || 0));
      } catch {
        if (!cancelled) setCount(0);
      }
    }

    void refresh();
    const onChanged = () => {
      void refresh();
    };
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener(INTERNAL_NOTIFICATIONS_CHANGED_EVENT, onChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(() => {
      void refresh();
    }, 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener(INTERNAL_NOTIFICATIONS_CHANGED_EVENT, onChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
    };
  }, [enabled, schoolCode]);

  return count;
}
