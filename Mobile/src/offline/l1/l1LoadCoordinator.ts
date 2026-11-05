/**
 * PERF-PR5 — coordination des lectures des ressources L1 (sans React, testable).
 *
 * - Lecture forcée (sans `maxAgeMs`) : toujours une nouvelle lecture ; toute lecture plus
 *   ancienne de la même clé devient obsolète (après une mutation, une réponse antérieure
 *   ne peut pas écraser la relecture).
 * - Retour d'écran (`maxAgeMs`) : réutilise la lecture en cours, ou ne relit pas si la
 *   dernière réponse réseau de la même clé a moins de `maxAgeMs`.
 * La clé porte la portée (utilisateur, établissement, droits) : aucun héritage entre portées.
 */
import type { ResourceSnapshot } from "../../lib/dataTruth";

export type L1LoadTicket =
  | { kind: "join"; promise: Promise<void> }
  | { kind: "skip" }
  | {
      kind: "run";
      isCurrent: () => boolean;
      markFresh: () => void;
      clearFresh: () => void;
      track: (promise: Promise<void>) => Promise<void>;
    };

export function createL1LoadCoordinator(clock: () => number = () => Date.now()) {
  const inFlight = new Map<string, Promise<void>>();
  const freshAt = new Map<string, number>();
  const generation = new Map<string, number>();
  const stats = { started: 0, joined: 0, skippedFresh: 0 };

  function begin(key: string, maxAgeMs?: number): L1LoadTicket {
    if (maxAgeMs != null) {
      const running = inFlight.get(key);
      if (running) {
        stats.joined += 1;
        return { kind: "join", promise: running };
      }
      const at = freshAt.get(key);
      if (at != null && clock() - at < maxAgeMs) {
        stats.skippedFresh += 1;
        return { kind: "skip" };
      }
    }
    const mine = (generation.get(key) ?? 0) + 1;
    generation.set(key, mine);
    stats.started += 1;
    return {
      kind: "run",
      isCurrent: () => generation.get(key) === mine,
      markFresh: () => {
        if (generation.get(key) === mine) freshAt.set(key, clock());
      },
      clearFresh: () => {
        freshAt.delete(key);
      },
      track: (promise) => {
        inFlight.set(key, promise);
        void promise.finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        });
        return promise;
      },
    };
  }

  function reset() {
    inFlight.clear();
    freshAt.clear();
    // Les générations ne repartent pas de zéro : une lecture d'avant la remise à zéro reste obsolète.
    for (const [key, value] of generation) generation.set(key, value + 1);
  }

  return { begin, reset, stats };
}

/** Cache-first : la copie L1 ne remplace jamais une donnée déjà affichée pour la portée. */
export function applyCacheFirst<T>(current: ResourceSnapshot<T>, cached: ResourceSnapshot<T>): ResourceSnapshot<T> {
  return current.data.length ? current : cached;
}

export type L1SettleDecision<T> = {
  snapshot: (current: ResourceSnapshot<T>) => ResourceSnapshot<T>;
  /** replace : nouvelles lignes ; keep : lignes affichées conservées ; clear : lignes retirées. */
  data: "replace" | "keep" | "clear";
  fresh: "mark" | "clear" | "none";
};

/** Résultat final d'une lecture L1 appliqué à l'état affiché. */
export function settleL1Snapshot<T>(snapshot: ResourceSnapshot<T>): L1SettleDecision<T> {
  if (snapshot.accessDenied) {
    // 401/403 : la copie affichée (cache-first compris) est retirée.
    return { snapshot: () => snapshot, data: "clear", fresh: "clear" };
  }
  if ((snapshot.status === "error" || snapshot.status === "offline") && snapshot.data.length === 0) {
    // Échec sans copie L1 : les lignes déjà affichées pour cette portée restent visibles.
    return {
      snapshot: (current) => ({
        ...snapshot,
        data: current.data,
        ...(current.source === "l1-cache"
          ? { source: current.source, cachedAt: current.cachedAt, refreshFailed: true }
          : {}),
      }),
      data: "keep",
      fresh: "none",
    };
  }
  return { snapshot: () => snapshot, data: "replace", fresh: snapshot.source === "network" ? "mark" : "none" };
}
