/**
 * PERF-PR5 — indication de fraîcheur d'une copie L1.
 * L'heure vient uniquement des métadonnées L1 (`cachedAt` = meta.lastSuccessAt) : jamais inventée.
 * Une réponse réseau n'affiche rien (donnée fraîche du serveur).
 */
import type { ResourceSnapshot } from "./dataTruth";

export const L1_FRESHNESS_COPY = {
  synced: "Données synchronisées",
  offline: "Mode hors connexion",
  refreshing: "Actualisation en cours",
  refreshFailed: "Actualisation impossible — dernières données disponibles",
  unknownTime: "heure de synchronisation inconnue",
} as const;

export const L1_FRESHNESS_TEST_ID = "l1-freshness";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** « à 10:35 » le jour même, « le 03/11 à 10:35 » sinon ; null si la date est absente ou invalide. */
export function formatL1SyncMoment(cachedAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!cachedAt) return null;
  const at = new Date(cachedAt);
  if (Number.isNaN(at.getTime())) return null;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? `à ${time}` : `le ${pad(at.getDate())}/${pad(at.getMonth() + 1)} à ${time}`;
}

export function l1FreshnessLabel(
  snapshot: Pick<ResourceSnapshot<unknown>, "source" | "cachedAt" | "refreshing" | "refreshFailed">,
  input: { permissionsBootstrap?: string | null; now?: Date } = {},
): string | null {
  if (snapshot.source !== "l1-cache") return null;
  const moment = formatL1SyncMoment(snapshot.cachedAt, input.now);
  const synced = moment ? `${L1_FRESHNESS_COPY.synced} ${moment}` : `${L1_FRESHNESS_COPY.synced} (${L1_FRESHNESS_COPY.unknownTime})`;
  if (snapshot.refreshing) return `${L1_FRESHNESS_COPY.refreshing} — ${synced.toLowerCase()}`;
  if (input.permissionsBootstrap === "ready_offline") return `${L1_FRESHNESS_COPY.offline} — ${synced.toLowerCase()}`;
  if (snapshot.refreshFailed) return `${L1_FRESHNESS_COPY.refreshFailed} (${synced.toLowerCase()})`;
  return synced;
}
