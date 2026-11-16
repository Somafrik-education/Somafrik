/**
 * CARTE-PR3-M1 — contrôle d'entrée au portail. Le cardToken n'est envoyé qu'au serveur, jamais
 * persisté ni journalisé ; Idempotency-Key = operationId (une lecture physique, une opération).
 */
import { httpRequest } from "./httpClient";
import type { EntryScanBody } from "../lib/studentCardEntryControl";

export function recordEntryScan(body: EntryScanBody, options: { idempotencyKey: string }) {
  return httpRequest<unknown>("/student-cards/entry-scan", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options.idempotencyKey,
  });
}
