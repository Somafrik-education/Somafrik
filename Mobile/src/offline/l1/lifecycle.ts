import { L1_ERROR, type L1Partition, type L1Store } from "./types";

let generation = 0;
let lastPartition: L1Partition | null = null;
let lastStore: L1Store | null = null;
let lifecycleTail = Promise.resolve();

function enqueueLifecycle<T>(fn: () => Promise<T>): Promise<T> {
  const run = lifecycleTail.then(fn, fn);
  lifecycleTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function currentL1Generation(): number {
  return generation;
}

export function bumpL1Generation(): number {
  generation += 1;
  return generation;
}

export function rememberL1Runtime(store: L1Store, partition: L1Partition): void {
  lastStore = store;
  lastPartition = partition;
}

export function getRememberedL1Runtime(): { store: L1Store; partition: L1Partition } | null {
  if (!lastStore || !lastPartition) return null;
  return { store: lastStore, partition: lastPartition };
}

function samePartition(a: L1Partition | null, b: L1Partition): boolean {
  return Boolean(a && a.userId === b.userId && a.schoolId === b.schoolId);
}

/**
 * Purge la partition précédente si l'identité authentifiée a changé.
 * Sérialisé derrière logout/purge : un ancien epoch ne peut pas adopter.
 */
export async function adoptL1Runtime(
  store: L1Store,
  partition: L1Partition,
  expectedGeneration?: number,
): Promise<boolean> {
  return enqueueLifecycle(async () => {
    if (expectedGeneration != null && expectedGeneration !== generation) return false;
    const previousStore = lastStore;
    const previousPartition = lastPartition;
    if (previousStore && previousPartition && !samePartition(previousPartition, partition)) {
      await previousStore.purgePartition(previousPartition);
    }
    lastStore = store;
    lastPartition = partition;
    return true;
  });
}

export function resolveL1Partition(session: {
  user?: { id?: string; schoolId?: string; schoolCode?: string };
  school?: { id?: string; code?: string };
} | null): { ok: true; partition: L1Partition } | { ok: false; code: string; message: string } {
  const userId = String(session?.user?.id ?? "").trim();
  const schoolId = String(session?.school?.id ?? session?.user?.schoolId ?? "").trim();
  const schoolCode = String(session?.school?.code ?? session?.user?.schoolCode ?? "").trim().toUpperCase();
  if (!userId) {
    return {
      ok: false,
      code: L1_ERROR.USER_ID_REQUIRED,
      message: "Identité utilisateur absente : pas de cache L1.",
    };
  }
  if (!schoolId) {
    return {
      ok: false,
      code: L1_ERROR.SCHOOL_ID_REQUIRED,
      message:
        "schoolId canonique absent de la session authentifiée. Partition L1 refusée (school_code n'est pas un substitut).",
    };
  }
  return { ok: true, partition: { userId, schoolId, schoolCode } };
}

export async function purgeRememberedL1Partition(): Promise<void> {
  const store = lastStore;
  const partition = lastPartition;
  lastPartition = null;
  if (!store || !partition) return;
  await store.purgePartition(partition);
}

/**
 * Invalide toute sync en vol. generation++ puis purge TERMINÉE avant de rendre.
 * Une reconnexion (même userId+schoolId) attend cette purge via la file lifecycle.
 */
export async function invalidateL1CacheSession(): Promise<number> {
  return enqueueLifecycle(async () => {
    generation += 1;
    await purgeRememberedL1Partition();
    return generation;
  });
}

/** Nouvelle session de sync : attend que logout/purge de l'epoch précédent soit terminé. */
export async function beginL1Session(): Promise<number> {
  return enqueueLifecycle(async () => {
    generation += 1;
    return generation;
  });
}

export function resetL1LifecycleForTests(): void {
  generation = 0;
  lastPartition = null;
  lastStore = null;
  lifecycleTail = Promise.resolve();
}
