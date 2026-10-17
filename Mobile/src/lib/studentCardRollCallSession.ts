import { createIdempotencyKey } from "./networkResilience";
import { createRollCallDraft, type RollCallDraft, type RollCallMode } from "./studentCardRollCall";

/** Nouvelle session d'appel collectif : son UUID est aussi l'identifiant d'opération de la validation. */
export function startRollCallSession(context: { scopeKey: string; classId: string; date: string; mode?: RollCallMode }): RollCallDraft {
  return createRollCallDraft({ ...context, sessionId: createIdempotencyKey() });
}

/** CARTE-PR3-M2 — nouvelle session d'appel de classe complet : même UUID pour la liste, les scans et la validation. */
export function startClassRollCallContext(context: { scopeKey: string; classId: string; date: string }) {
  return { ...context, sessionId: createIdempotencyKey() };
}
