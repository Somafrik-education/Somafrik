import { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useAdminData } from "../../context/AdminDataContext";
import { isMetierRenderable } from "../../lib/livePermissionsRefresh";
import {
  CONNECTIVITY_POLL_MS,
  canReplayOutboxNow,
  probeConnectivity,
  subscribeConnectivity,
} from "../../lib/connectivity";
import {
  drainPresenceOutboxFromSession,
  flattenAckedPresenceBodies,
} from "./presenceWrite";

/**
 * Replay SQLCipher outbox présences après reconnect / cold boot.
 * N'utilise pas l'outbox JSON historique.
 */
export default function PresenceOutboxRuntime() {
  const { session, permissionsBootstrap } = useAuth();
  const { loadPresences, applyConfirmedPresences } = useAdminData();

  useEffect(() => {
    if (!session) return undefined;
    if (!isMetierRenderable(session, permissionsBootstrap)) return undefined;

    let cancelled = false;
    let inFlight = false;
    const run = async () => {
      if (cancelled || inFlight) return;
      if (!(await canReplayOutboxNow()) || cancelled) return;
      inFlight = true;
      try {
        const result = await drainPresenceOutboxFromSession(session);
        if (cancelled || !result?.acked) return;
        const saved = flattenAckedPresenceBodies(result.ackedBodies);
        if (saved.length) applyConfirmedPresences(saved);
        await loadPresences();
      } catch {
        /* fail-closed : ne pas inventer une file vide */
      } finally {
        inFlight = false;
      }
    };

    void run();
    const unsubscribe = subscribeConnectivity((state) => {
      if (state === "online") void run();
    });
    const timer = setInterval(() => {
      void (async () => {
        if (cancelled) return;
        const online = await probeConnectivity();
        if (online && !cancelled) void run();
      })();
    }, CONNECTIVITY_POLL_MS);

    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(timer);
    };
  }, [
    applyConfirmedPresences,
    loadPresences,
    permissionsBootstrap,
    session,
    session?.school?.id,
    session?.user?.id,
  ]);

  return null;
}
