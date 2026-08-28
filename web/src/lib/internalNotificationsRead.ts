import { useEffect, useState } from "react";
import { internalNotificationsApi } from "./internalNotificationsApi";

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
    void internalNotificationsApi
      .unreadCount(schoolCode ?? undefined)
      .then((result) => {
        if (!cancelled) setCount(Math.max(0, Number(result.count) || 0));
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
