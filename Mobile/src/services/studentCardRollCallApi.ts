/**
 * CARTE-PR1 — appel collectif. Le cardToken ne quitte l'appareil que vers le scan
 * brouillon ; il n'est jamais persisté ni journalisé. Les réponses ne portent aucune identité.
 */
import { httpRequest } from "./httpClient";

export type RollCallScanResponse = {
  status: "accepted";
  receipt: string;
  dedupKey: string;
  expiresAt: string;
};

export type RollCallValidateResponse = {
  recorded: number;
  duplicatesIgnored: number;
  classId: string;
  date: string;
};

export function scanRollCallCard(input: { sessionId: string; classId: string; date: string; cardToken: string }) {
  return httpRequest<RollCallScanResponse>("/student-cards/roll-call/scan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function validateRollCall(
  body: { sessionId: string; classId: string; date: string; receipts: string[]; teacherId?: string },
  options: { idempotencyKey: string },
) {
  return httpRequest<RollCallValidateResponse>("/student-cards/roll-call/validate", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options.idempotencyKey,
  });
}
