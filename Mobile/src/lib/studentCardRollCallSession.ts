import { createIdempotencyKey } from "./networkResilience";
import { createRollCallDraft, type RollCallDraft } from "./studentCardRollCall";

/** Nouvelle session d'appel collectif : son UUID est aussi l'identifiant d'opération de la validation. */
export function startRollCallSession(context: { scopeKey: string; classId: string; date: string }): RollCallDraft {
  return createRollCallDraft({ ...context, sessionId: createIdempotencyKey() });
}
