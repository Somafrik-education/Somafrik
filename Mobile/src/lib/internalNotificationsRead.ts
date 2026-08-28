import { useCallback, useEffect, useState } from "react";
import { getInternalNotificationsUnreadCount } from "../services/internalNotificationsApi";

export function useInternalNotificationsUnreadCount(enabled: boolean, schoolCode?: string | null) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      setCount(await getInternalNotificationsUnreadCount(schoolCode ?? undefined));
    } catch {
      setCount(0);
    }
  }, [enabled, schoolCode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { count, refresh };
}
