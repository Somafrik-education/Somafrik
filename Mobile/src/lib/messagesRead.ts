import { useCallback, useEffect, useState } from "react";
import { getMessagesUnreadCount } from "../services/domainHydrationApi";

/**
 * Badge / KPI Messages : compteur PostgreSQL.
 * Aucun statut local « Nouveau » ni filtre direction comme SoT.
 */
export function useMessagesUnreadCount(enabled: boolean, schoolCode?: string | null) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      setCount(await getMessagesUnreadCount(schoolCode ?? undefined));
    } catch {
      setCount(0);
    }
  }, [enabled, schoolCode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { count, refresh };
}
