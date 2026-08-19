import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { bindOutboxToSession, processOutbox, type OutboxEntry } from "../lib/outbox";
import {
  createSchoolPayment,
  saveNote,
  savePresences,
  sendClientsMessage,
} from "../services/api";

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
  const { session } = useAuth();
  const { loadPresences, loadNotes, loadPayments } = useAdminData();

  useEffect(() => {
    if (!session) return undefined;
    const fingerprint = {
      userId: String(session.user?.id ?? ""),
      schoolScope: String(session.school?.code ?? session.user?.schoolCode ?? "").toUpperCase(),
    };
    if (!fingerprint.userId || !fingerprint.schoolScope) return undefined;

    let cancelled = false;
    const run = async () => {
      await bindOutboxToSession(fingerprint);
      if (cancelled) return;
      const result = await processOutbox(fingerprint, dispatchOutboxEntry);
      if (cancelled || !result.sent) return;
      await Promise.all([loadPresences(), loadNotes(), loadPayments()]);
    };

    void run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [loadNotes, loadPayments, loadPresences, session?.school?.code, session?.user?.id, session?.user?.schoolCode]);

  return null;
}
