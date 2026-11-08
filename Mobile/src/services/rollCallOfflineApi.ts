/**
 * NFC-PRES-LOCAL-PR3 — téléchargement du pack signé d'appel hors connexion (route PR1b).
 *
 * Le texte de la réponse est renvoyé TEL QUEL (il est stocké et revérifié octet pour octet) avec
 * l'en-tête `Date` du serveur (horloge de confiance). Aucune lecture du pack ici : la
 * vérification Ed25519 est faite par Mobile/src/offline/rollCall/pack.
 */
import { httpRequest } from "./httpClient";

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
