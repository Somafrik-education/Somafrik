/**
 * NFC-PRES-LOCAL-PR3 — téléchargement du pack signé d'appel hors connexion (route PR1b).
 *
 * Le texte de la réponse est renvoyé TEL QUEL (il est stocké et revérifié octet pour octet) avec
 * l'en-tête `Date` du serveur (horloge de confiance). Aucune lecture du pack ici : la
 * vérification Ed25519 est faite par Mobile/src/offline/rollCall/pack.
 */
import { ApiClientError, httpRequest } from "./httpClient";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PACK_TEXT = 512 * 1024;

export async function downloadOfflineRollCallPack(input: { classId: string; date: string }): Promise<{ text: string; dateHeader: string | null }> {
  if (!UUID.test(input.classId) || !ISO_DATE.test(input.date)) throw new Error("Paramètres du pack invalides.");
  const query = `classId=${encodeURIComponent(input.classId)}&date=${encodeURIComponent(input.date)}`;
  const response = await httpRequest<Response>(`/student-cards/roll-call/offline/v1/pack?${query}`, {
    raw: true,
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  if (text.length === 0 || text.length > MAX_PACK_TEXT) throw new Error("Réponse du pack invalide.");
  return { text, dateHeader: response.headers.get("date") };
}

const MAX_SYNC_RESPONSE = 64 * 1024;
export const ROLL_CALL_SYNC_TIMEOUT_MS = 30_000;

export type OfflineRollCallSyncResponse =
  | { kind: "network"; code: "TIMEOUT" | "NETWORK" }
  | { kind: "http"; status: number; body: unknown; dateHeader: string | null };

/**
 * NFC-PRES-LOCAL-PR4 — envoi d'un lot clôturé (route PR1c). `body` est la chaîne figée lue dans la
 * base SQLCipher, transmise telle quelle (jamais re-sérialisée) ; `operationId` en Idempotency-Key.
 * Aucune donnée du lot n'est journalisée.
 */
export async function sendOfflineRollCallSync(input: { operationId: string; body: string }): Promise<OfflineRollCallSyncResponse> {
  if (!UUID.test(input.operationId) || typeof input.body !== "string" || input.body.length === 0) {
    throw new Error("Lot de synchronisation invalide.");
  }
  let response: Response;
  try {
    response = await httpRequest<Response>("/student-cards/roll-call/offline/v1/sync", {
      method: "POST",
      raw: true,
      rawAnyStatus: true,
      body: input.body,
      idempotencyKey: input.operationId,
      timeoutMs: ROLL_CALL_SYNC_TIMEOUT_MS,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof ApiClientError && typeof error.status === "number") {
      // 401 après échec du rafraîchissement : session expirée, état serveur non confirmable.
      return { kind: "http", status: error.status, body: error.code ? { code: error.code } : null, dateHeader: null };
    }
    const code = (error as { code?: unknown })?.code === "TIMEOUT" ? "TIMEOUT" : "NETWORK";
    return { kind: "network", code };
  }
  const dateHeader = response.headers.get("date");
  let text = "";
  try {
    text = await response.text();
  } catch {
    // Corps illisible : réponse inconnue, renvoi identique plus tard.
    return { kind: "network", code: "NETWORK" };
  }
  let body: unknown = null;
  if (text.length > 0 && text.length <= MAX_SYNC_RESPONSE) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { kind: "http", status: response.status, body, dateHeader };
}
