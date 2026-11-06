import { useCallback, useEffect, useState } from "react";
import { getInternalNotificationsUnreadCount } from "../services/internalNotificationsApi";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Signale un changement d'état lu (ex. clic Push) : les compteurs se relisent sur le serveur. */
export function notifyInternalNotificationsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // un abonné défaillant ne bloque pas les autres
    }
  }
}

export function subscribeInternalNotificationsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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

  useEffect(
    () =>
      subscribeInternalNotificationsChanged(() => {
        void refresh();
      }),
    [refresh],
  );

  return { count, refresh };
}
