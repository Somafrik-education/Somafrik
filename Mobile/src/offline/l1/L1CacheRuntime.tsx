import { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { createL1Api } from "./syncApi";
import { httpRequest } from "../../services/httpClient";
import { openNativeL1Database } from "./database";
import {
  adoptL1Runtime,
  beginL1Session,
  currentL1Generation,
  invalidateL1CacheSession,
  resolveL1Partition,
} from "./lifecycle";
import { syncL1Cache } from "./syncEngine";
import { safeLogger } from "../../services/safeLogger";

/**
 * Runtime de remplissage L1. Aucun branchement d'écran.
 * Sync seulement si permissionsBootstrap=ready. ready_offline : ne pas
 * toucher aux curseurs ni purger un cache ready.
 */
export default function L1CacheRuntime() {
  const { session, permissionsBootstrap } = useAuth();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!session) {
        await invalidateL1CacheSession();
        return;
      }
      if (permissionsBootstrap === "ready_offline") {
        return;
      }
      if (permissionsBootstrap !== "ready") {
        return;
      }

      const resolved = resolveL1Partition(session);
      if (!resolved.ok) {
        safeLogger.warn("l1_partition_refused", { code: resolved.code });
        return;
      }

      const generation = await beginL1Session();
      if (cancelled || currentL1Generation() !== generation) return;
      const opened = await openNativeL1Database();
      if (cancelled || currentL1Generation() !== generation) return;
      if (!opened.ok) {
        safeLogger.warn("l1_sqlcipher_required", { code: opened.code });
        return;
      }
      const adopted = await adoptL1Runtime(opened.store, resolved.partition, generation);
      if (!adopted || cancelled || currentL1Generation() !== generation) return;
      await syncL1Cache({
        store: opened.store,
        api: createL1Api(httpRequest),
        partition: resolved.partition,
        isCurrent: () => !cancelled && currentL1Generation() === generation,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [permissionsBootstrap, session, session?.school?.id, session?.user?.id]);

  return null;
}
