/**
 * Lecteur L1 unique. Les écrans ne touchent jamais SQLite.
 * PostgreSQL reste l'autorité ; SQLite n'est qu'une projection locale jetable.
 */
import {
  snapshotFromFailure,
  snapshotFromL1Cache,
  snapshotFromSuccess,
  snapshotL1Unavailable,
  type ResourceSnapshot,
} from "../../lib/dataTruth";
import { openNativeL1Database } from "./database";
import { getRememberedL1Runtime, rememberL1Runtime, resolveL1Partition } from "./lifecycle";
import { logRc2L1ReadFromSnapshot, logRc2L1Refusal } from "./rc2OfflineReadSmoke";
import type { L1OpenResult, L1Partition, L1Resource, L1Store, L1SyncMeta, SqlValue } from "./types";

export type L1SessionLike = {
  user?: { id?: string; schoolId?: string; schoolCode?: string };
  school?: { id?: string; code?: string };
} | null;

export type L1ReadRefusal =
  | "empty"
  | "reconciling"
  | "blocked_authorization"
  | "metadata_absent"
  | "partition_mismatch"
  | "sqlcipher_unavailable"
  | "partition_unresolved";

export type L1ReadOk = {
  ok: true;
  partition: L1Partition;
  meta: L1SyncMeta;
  rows: Record<string, SqlValue>[];
};

export type L1ReadResult = L1ReadOk | { ok: false; reason: L1ReadRefusal };

export type L1ReadDeps = {
  openStore?: () => Promise<L1OpenResult>;
  remembered?: () => { store: L1Store; partition: L1Partition } | null;
};

let testDeps: L1ReadDeps | null = null;

export function setL1ReadDepsForTests(deps: L1ReadDeps | null): void {
  testDeps = deps;
}

export function isStrictNetworkUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status =
    "status" in error ? Number((error as { status?: number }).status) : Number.NaN;
  if (Number.isFinite(status) && status > 0) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "NETWORK_UNAVAILABLE";
}

/**
 * PERF-PR5 — échecs de transport qui autorisent la lecture de la dernière copie L1.
 * Aucune réponse HTTP n'a été reçue : ce n'est ni un refus d'accès ni une erreur serveur.
 */
export const L1_TRANSPORT_FALLBACK_CODES = ["NETWORK_UNAVAILABLE", "TIMEOUT", "BACKEND_UNREACHABLE"] as const;

export function isL1TransportFallbackEligible(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status =
    "status" in error ? Number((error as { status?: number }).status) : Number.NaN;
  if (Number.isFinite(status) && status > 0) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return (L1_TRANSPORT_FALLBACK_CODES as readonly string[]).includes(code);
}

/** 401/403 : refus d'accès. Jamais une autorisation de lire, ni de garder, le cache. */
export function isAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = Number((error as { status?: number }).status);
  return status === 401 || status === 403;
}

/**
 * Lecture L1 avant le réseau (cache-first) uniquement si les droits de la session ont été
 * établis par le serveur : en ligne (`ready`) ou par l'instantané hors ligne validé (`ready_offline`).
 * Tout autre état (chargement, erreur, inconnu) échoue fermé.
 */
export function canReadL1BeforeNetwork(permissionsBootstrap?: string | null): boolean {
  return permissionsBootstrap === "ready" || permissionsBootstrap === "ready_offline";
}

export function shouldSkipMetierGet(permissionsBootstrap?: string | null): boolean {
  return permissionsBootstrap === "ready_offline";
}

export function shouldBlockUnsupportedMutations(input: {
  source?: ResourceSnapshot<unknown>["source"];
  permissionsBootstrap?: string | null;
}): boolean {
  return input.source === "l1-cache" || input.permissionsBootstrap === "ready_offline";
}

export function l1ReadInteractionPolicy(input: {
  snapshot: Pick<ResourceSnapshot<unknown>, "status" | "source">;
  permissionsBootstrap?: string | null;
}): {
  searchEnabled: boolean;
  navigationEnabled: boolean;
  mutationsEnabled: boolean;
  readAvailable: boolean;
} {
  const readAvailable = input.snapshot.status === "success" || input.snapshot.status === "empty";
  const cacheRead = readAvailable && input.snapshot.source === "l1-cache";
  const offlineBootstrap = input.permissionsBootstrap === "ready_offline";
  return {
    searchEnabled: true,
    navigationEnabled: readAvailable,
    mutationsEnabled: !shouldBlockUnsupportedMutations({
      source: input.snapshot.source,
      permissionsBootstrap: input.permissionsBootstrap,
    }),
    readAvailable: readAvailable || cacheRead || offlineBootstrap,
  };
}

function samePartition(left: L1Partition, right: L1Partition): boolean {
  return left.userId === right.userId && left.schoolId === right.schoolId;
}

async function resolveStore(
  partition: L1Partition,
  deps?: L1ReadDeps,
): Promise<{ ok: true; store: L1Store } | { ok: false; reason: "sqlcipher_unavailable" }> {
  const openStore = deps?.openStore ?? testDeps?.openStore;
  if (!openStore) {
    const remembered = (deps?.remembered ?? testDeps?.remembered ?? getRememberedL1Runtime)();
    if (remembered && samePartition(remembered.partition, partition)) {
      return { ok: true, store: remembered.store };
    }
  }

  const opened = await (openStore ?? openNativeL1Database)();
  if (!opened.ok) {
    return { ok: false, reason: "sqlcipher_unavailable" };
  }
  void rememberL1Runtime(opened.store, partition);
  return { ok: true, store: opened.store };
}

function refuse(resource: L1Resource, reason: L1ReadRefusal): L1ReadResult {
  logRc2L1Refusal({ resource, reason });
  return { ok: false, reason };
}

/**
 * Lit une ressource L1 uniquement si meta.state === "ready" dans la partition
 * exacte userId+schoolId. ready + 0 rows = vide métier confirmé.
 */
export async function readL1Resource(input: {
  session: L1SessionLike;
  resource: L1Resource;
  deps?: L1ReadDeps;
}): Promise<L1ReadResult> {
  const resolved = resolveL1Partition(input.session);
  if (!resolved.ok) {
    return refuse(input.resource, "partition_unresolved");
  }
  const { partition } = resolved;

  const storeResult = await resolveStore(partition, input.deps);
  if (!storeResult.ok) return refuse(input.resource, storeResult.reason);

  let meta: L1SyncMeta | null;
  try {
    meta = await storeResult.store.getMeta(partition, input.resource);
  } catch {
    return refuse(input.resource, "sqlcipher_unavailable");
  }

  if (!meta) {
    return refuse(input.resource, "metadata_absent");
  }
  if (meta.userId !== partition.userId || meta.schoolId !== partition.schoolId) {
    return refuse(input.resource, "partition_mismatch");
  }
  if (meta.state === "empty" || meta.state === "reconciling" || meta.state === "blocked_authorization") {
    return refuse(input.resource, meta.state);
  }
  if (meta.state !== "ready") {
    return refuse(input.resource, "empty");
  }

  let rows: Record<string, SqlValue>[];
  try {
    rows = await storeResult.store.listRows(input.resource, partition);
  } catch {
    return refuse(input.resource, "sqlcipher_unavailable");
  }
  return { ok: true, partition, meta, rows };
}

export function snapshotFromL1Read<T>(
  read: L1ReadResult,
  project: (read: L1ReadOk) => T[],
): ResourceSnapshot<T> {
  if (!read.ok) {
    return snapshotL1Unavailable();
  }
  return snapshotFromL1Cache(project(read), read.meta.lastSuccessAt);
}

export async function loadL1BackedSnapshot<T>(input: {
  session: L1SessionLike;
  permissionsBootstrap?: string | null;
  resource: L1Resource;
  fetchNetwork: () => Promise<T[]>;
  project: (read: L1ReadOk) => T[] | Promise<T[]>;
  deps?: L1ReadDeps;
  /**
   * PERF-PR5 — cache-first : appelé avec la copie L1 dès qu'elle est lue, si le réseau
   * n'a pas encore répondu. Le résultat final (réseau ou repli) reste la valeur retournée.
   */
  onCacheSnapshot?: (snapshot: ResourceSnapshot<T>) => void;
}): Promise<ResourceSnapshot<T>> {
  const readAndProject = async (): Promise<ResourceSnapshot<T>> => {
    const read = await readL1Resource({
      session: input.session,
      resource: input.resource,
      deps: input.deps,
    });
    if (!read.ok) return snapshotL1Unavailable();
    return snapshotFromL1Cache(await input.project(read), read.meta.lastSuccessAt);
  };

  if (!input.session) {
    return snapshotL1Unavailable();
  }

  let snapshot: ResourceSnapshot<T>;
  if (shouldSkipMetierGet(input.permissionsBootstrap)) {
    snapshot = await readAndProject();
  } else {
    // Cache-first : la lecture locale part en parallèle du réseau, droits établis uniquement.
    let networkSettled = false;
    const cacheFirst =
      input.onCacheSnapshot && canReadL1BeforeNetwork(input.permissionsBootstrap)
        ? readAndProject().then(
            (cached) => {
              if (!networkSettled && cached.source === "l1-cache") {
                input.onCacheSnapshot?.({ ...cached, refreshing: true });
              }
              return cached;
            },
            () => snapshotL1Unavailable<T>(),
          )
        : null;
    try {
      const rows = await input.fetchNetwork();
      networkSettled = true;
      snapshot = snapshotFromSuccess(rows, { source: "network" });
    } catch (error) {
      networkSettled = true;
      if (isL1TransportFallbackEligible(error)) {
        // Timeout, réseau ou serveur injoignable : dernière copie autorisée, signalée comme telle.
        const cached = await (cacheFirst ?? readAndProject());
        if (cached.source === "l1-cache") {
          snapshot = { ...cached, refreshing: false, refreshFailed: true };
        } else if (isStrictNetworkUnavailable(error)) {
          snapshot = cached; // historique : « Cache hors ligne indisponible ».
        } else {
          snapshot = snapshotFromFailure(error, []); // délai / serveur injoignable sans copie : erreur explicite.
        }
      } else if (isAccessDenied(error)) {
        snapshot = { ...snapshotFromFailure<T>(error, []), accessDenied: true };
      } else {
        snapshot = snapshotFromFailure(error, []);
      }
    }
  }

  logRc2L1ReadFromSnapshot(input.resource, snapshot);
  return snapshot;
}
