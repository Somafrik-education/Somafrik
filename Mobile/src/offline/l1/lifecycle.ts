import { L1_ERROR, type L1Partition } from "./types";
import type { L1Store } from "./types";

let generation = 0;
let lastPartition: L1Partition | null = null;
let lastStore: L1Store | null = null;

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

function samePartition(a: L1Partition | null, b: L1Partition): boolean {
  return Boolean(a && a.userId === b.userId && a.schoolId === b.schoolId);
}

/** Purge la partition précédente si l'identité authentifiée a changé. */
export async function adoptL1Runtime(store: L1Store, partition: L1Partition): Promise<void> {
  const previousStore = lastStore;
  const previousPartition = lastPartition;
  lastStore = store;
  lastPartition = partition;
  if (previousStore && previousPartition && !samePartition(previousPartition, partition)) {
    await previousStore.purgePartition(previousPartition);
  }
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
 * Invalide toute sync en vol. Appelé au logout / 401 avant qu'une réponse tardive
 * ne puisse réinsérer la partition A.
 */
export function invalidateL1CacheSession(): number {
  const next = bumpL1Generation();
  void purgeRememberedL1Partition();
  return next;
}
