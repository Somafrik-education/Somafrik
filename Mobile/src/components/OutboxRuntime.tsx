import { useEffect } from "react";
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
  const { session, permissionsBootstrap } = useAuth();
  const { loadPresences, loadNotes, loadPayments } = useAdminData();

  useEffect(() => {
    // L8 : aucun write outbox tant que les permissions live ne sont pas ready.
    // Le retour foreground passe par AuthContext (bootstrap loading → ready) ;
    // cet effet relance processOutbox uniquement après la revalidation.
    if (!session || permissionsBootstrap !== "ready") return undefined;
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
    return () => {
      cancelled = true;
    };
  }, [loadNotes, loadPayments, loadPresences, permissionsBootstrap, session?.school?.code, session?.user?.id, session?.user?.schoolCode]);

  return null;
}
