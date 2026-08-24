import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import {
  CONNECTIVITY_POLL_MS,
  CONNECTIVITY_PROBE_TIMEOUT_MS,
  isOfflineContext,
  probeConnectivity,
  setConnectivityProbe,
  subscribeConnectivity,
} from "../lib/connectivity";
import {
  bindOutboxToSession,
  countPendingOutbox,
  processOutbox,
  type OutboxEntry,
} from "../lib/outbox";
import {
  createSchoolPayment,
  saveNote,
  savePresences,
  sendClientsMessage,
} from "../services/api";
import { httpRequest } from "../services/httpClient";

setConnectivityProbe(async () => {
  await httpRequest("/health", { skipAuth: true, timeoutMs: CONNECTIVITY_PROBE_TIMEOUT_MS });
  return true;
});

async function dispatchOutboxEntry(entry: OutboxEntry) {
  const options = { idempotencyKey: entry.idempotencyKey };
  const payload = entry.payload as Record<string, unknown>;
  switch (entry.domain) {
    case "messages":
      return sendClientsMessage(payload, options);
    case "presences":
      return savePresences(payload, options);
    case "notes":
      return saveNote(payload, options);
    case "payments":
      return createSchoolPayment(payload, options);
    default:
      throw new Error("OUTBOX_DOMAIN_FORBIDDEN");
  }
}

export default function OutboxRuntime() {
  const { session, permissionsBootstrap } = useAuth();
  const { loadPresences, loadNotes, loadPayments, applyConfirmedPresences } = useAdminData();

  useEffect(() => {
    // L8 : aucun replay outbox tant que les permissions live ne sont pas ready.
    if (!session || permissionsBootstrap !== "ready") return undefined;
    const fingerprint = {
      userId: String(session.user?.id ?? ""),
      schoolScope: String(session.school?.code ?? session.user?.schoolCode ?? "").toUpperCase(),
    };
    if (!fingerprint.userId || !fingerprint.schoolScope) return undefined;

    let cancelled = false;
    let inFlight = false;
    const run = async () => {
      if (cancelled || inFlight) return;
      if (isOfflineContext()) {
        const online = await probeConnectivity();
        if (!online || cancelled) return;
      }
      inFlight = true;
      try {
        await bindOutboxToSession(fingerprint);
        if (cancelled) return;
        const result = await processOutbox(fingerprint, async (entry) => {
          const saved = await dispatchOutboxEntry(entry);
          if (entry.domain === "presences" && Array.isArray(saved) && saved.length) {
            applyConfirmedPresences(saved);
          }
          return saved;
        });
        if (cancelled || !result.sent) return;
        await Promise.all([loadPresences(), loadNotes(), loadPayments()]);
      } catch {
        /* lecture outbox KO : ne pas traiter comme une file vide */
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
        let pending: number;
        try {
          pending = await countPendingOutbox(fingerprint);
        } catch {
          return;
        }
        if (cancelled || pending <= 0) return;
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
    loadNotes,
    loadPayments,
    loadPresences,
    permissionsBootstrap,
    session?.school?.code,
    session?.user?.id,
    session?.user?.schoolCode,
  ]);

  return null;
}
